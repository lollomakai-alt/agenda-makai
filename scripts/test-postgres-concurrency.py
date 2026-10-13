"""Run the real PostgreSQL booking race checks in an isolated temporary cluster.

Requires PostgreSQL 17 binaries and psycopg 3. Never connects to Supabase.
"""

import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time
from datetime import date, timedelta

import psycopg


ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.environ.get("MAKAI_POSTGRES_BIN", "/opt/homebrew/opt/postgresql@17/bin"))
PORT = 55439


def run(*args, env=None):
    subprocess.run(args, check=True, text=True, stdout=subprocess.DEVNULL, env=env)


def next_service_days(count):
    day = date.today() + timedelta(days=10)
    result = []
    while len(result) < count:
        if day.weekday() != 0:
            result.append(day.isoformat())
        day += timedelta(days=1)
    return result


def main():
    with tempfile.TemporaryDirectory(prefix="makai-pg-", dir="/private/tmp") as tmp:
        base = Path(tmp)
        data = base / "data"
        socket = base / "socket"
        socket.mkdir()
        run(str(BIN / "initdb"), "-D", str(data), "-A", "trust", "--no-instructions")
        options = f"-p {PORT} -k {socket} -c listen_addresses= -c fsync=off"
        run(str(BIN / "pg_ctl"), "-D", str(data), "-l", str(base / "server.log"), "-o", options, "start")
        env = dict(os.environ, PGHOST=str(socket), PGPORT=str(PORT), PGUSER=getpass.getuser(), PGDATABASE="postgres")
        connect = f"host={socket} port={PORT} user={getpass.getuser()} dbname=postgres"
        try:
            helper = (ROOT / "tests/helpers/bookingDatabase.js").read_text()
            bootstrap = helper.split("await db.exec(`", 1)[1].split("`);", 1)[0]
            bootstrap_file = base / "bootstrap.sql"
            bootstrap_file.write_text(bootstrap)
            run(str(BIN / "psql"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", str(bootstrap_file), env=env)
            file_list = helper.split("for (const file of [", 1)[1].split("])", 1)[0]
            sql_files = re.findall(r"'([^']+\.sql)'", file_list)
            if not sql_files or sql_files[-1] != "complete-booking-system.sql":
                raise AssertionError("Migration fixture list changed")
            for filename in sql_files[:-1]:
                run(str(BIN / "psql"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", str(ROOT / "supabase" / filename), env=env)
            with psycopg.connect(connect, autocommit=True) as conn:
                conn.execute("""
                    create function private.enforce_daily_booking_capacity_25() returns trigger
                    language plpgsql as $$ begin
                      if new.source='booking' and new.status='confirmed' and
                        (select coalesce(sum(party_size),0) from public.bookings
                         where booking_date=new.booking_date and status='confirmed' and id<>new.id)
                        + new.party_size > 25 then
                        raise exception 'legacy combined cap';
                      end if;
                      return new;
                    end $$;
                    create trigger y_enforce_daily_booking_capacity_25
                    before insert or update of booking_date,party_size,status on public.bookings
                    for each row execute function private.enforce_daily_booking_capacity_25();
                    grant delete on public.bookings to authenticated;
                    create policy booking_owner_delete on public.bookings for delete to authenticated
                    using (source='booking' and user_id=auth.uid());
                """)
            run(str(BIN / "psql"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", str(ROOT / "supabase/complete-booking-system.sql"), env=env)
            with psycopg.connect(connect, autocommit=True) as conn:
                conn.execute("create trigger prepare_booking before insert or update on public.bookings for each row execute function private.prepare_booking()")
                assert conn.execute("select count(*) from pg_trigger where tgname='y_enforce_daily_booking_capacity_25'").fetchone()[0] == 0
                assert conn.execute("select count(*) from pg_policies where policyname='booking_owner_delete'").fetchone()[0] == 0
                assert not conn.execute("select has_table_privilege('authenticated','public.bookings','DELETE')").fetchone()[0]

            days = next_service_days(5)
            groups = [("10+11", 2), ("12", 2), ("13+14", 3), ("15+16+17", 6), ("18+19", 4), ("20+21", 4), ("22", 2)]
            with psycopg.connect(connect, autocommit=True) as conn:
                for group, people in groups:
                    conn.execute("insert into public.bookings(name,booking_date,booking_time,party_size,tables,source,status,booking_type) values ('Staff',%s,'19:00',%s,%s,'agenda','confirmed','normale')", (days[0], people, group))

            def concurrent_inserts(day, kind, people, group=None):
                barrier = threading.Barrier(2)
                results = [None, None]

                def worker(index):
                    try:
                        with psycopg.connect(connect) as conn:
                            barrier.wait(timeout=10)
                            with conn.transaction():
                                if kind == "manual":
                                    conn.execute("insert into public.bookings(name,booking_date,booking_time,party_size,tables,source,status,booking_type) values ('Staff',%s,'19:00',2,%s,'agenda','confirmed','normale')", (day, group))
                                else:
                                    conn.execute("insert into public.bookings(name,phone,email,booking_date,booking_time,party_size,tables,source,status,booking_type,privacy_accepted_at,privacy_version) values ('Cliente',%s,'',%s,%s,%s,'','booking','confirmed',%s,now(),'2026-10-12-online-v2')", (f"+3933300000{1 if kind == 'after' else 2}{index}", day, "23:00" if kind == "after" else "19:00", people, "dopocena" if kind == "after" else "normale"))
                                time.sleep(0.2)
                        results[index] = "committed"
                    except psycopg.Error as error:
                        results[index] = error.sqlstate or "database_error"

                threads = [threading.Thread(target=worker, args=(i,)) for i in range(2)]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join(timeout=20)
                assert all(not thread.is_alive() for thread in threads), results
                assert results.count("committed") == 1, results
                return results

            last_table = concurrent_inserts(days[0], "dinner", 2)
            with psycopg.connect(connect, autocommit=True) as conn:
                for i in range(4):
                    conn.execute("insert into public.bookings(name,booking_date,booking_time,party_size,tables,source,status,booking_type) values ('Staff',%s,'23:00',6,'','agenda','confirmed','dopocena')", (days[1],))
            after_limit = concurrent_inserts(days[1], "after", 1)
            same_table = concurrent_inserts(days[2], "manual", 2, "12")

            # Cancellation holds its row/advisory lock while the new reservation waits.
            with psycopg.connect(connect, autocommit=True) as conn:
                victim = conn.execute("select id from public.bookings where booking_date=%s and tables='23' and status='confirmed'", (days[0],)).fetchone()[0]
            updated = threading.Event()
            release = threading.Event()
            outcomes = {}

            def cancel():
                try:
                    with psycopg.connect(connect) as conn:
                        with conn.transaction():
                            conn.execute("update public.bookings set status='cancelled' where id=%s", (victim,))
                            updated.set()
                            assert release.wait(timeout=10)
                    outcomes["cancel"] = "committed"
                except Exception as error:
                    outcomes["cancel"] = str(error)
                    updated.set()

            def replace():
                try:
                    assert updated.wait(timeout=10)
                    with psycopg.connect(connect) as conn:
                        with conn.transaction():
                            conn.execute("insert into public.bookings(name,phone,email,booking_date,booking_time,party_size,tables,source,status,booking_type,privacy_accepted_at,privacy_version) values ('Cliente','+393330000099','',%s,'19:00',2,'','booking','confirmed','normale',now(),'2026-10-12-online-v2')", (days[0],))
                    outcomes["replace"] = "committed"
                except Exception as error:
                    outcomes["replace"] = str(error)

            first = threading.Thread(target=cancel)
            second = threading.Thread(target=replace)
            first.start()
            second.start()
            assert updated.wait(timeout=10)
            time.sleep(0.3)
            release.set()
            first.join(timeout=20)
            second.join(timeout=20)
            assert outcomes == {"cancel": "committed", "replace": "committed"}, outcomes

            # The former live trigger combined the two services into one 25-cover cap.
            with psycopg.connect(connect, autocommit=True) as conn:
                for group, people in groups + [("23", 2)]:
                    conn.execute("insert into public.bookings(name,booking_date,booking_time,party_size,tables,source,status,booking_type) values ('Staff',%s,'19:00',%s,%s,'agenda','confirmed','normale')", (days[4], people, group))
                conn.execute("insert into public.bookings(name,phone,email,booking_date,booking_time,party_size,tables,source,status,booking_type,privacy_accepted_at,privacy_version) values ('Cliente','+393330000088','',%s,'23:00',1,'','booking','confirmed','dopocena',now(),'2026-10-12-online-v2')", (days[4],))

            with psycopg.connect(connect, autocommit=True) as conn:
                dinner_people = conn.execute("select sum(party_size) from public.bookings where booking_date=%s and booking_type='normale' and status not in ('cancelled','no_show')", (days[0],)).fetchone()[0]
                after_people = conn.execute("select sum(party_size) from public.bookings where booking_date=%s and booking_type='dopocena' and status not in ('cancelled','no_show')", (days[1],)).fetchone()[0]
                independent_people = conn.execute("select booking_type,sum(party_size) from public.bookings where booking_date=%s and status not in ('cancelled','no_show') group by booking_type", (days[4],)).fetchall()
                shared = conn.execute("""with x as (select b.booking_date,b.id,btrim(p.id) physical_id from public.bookings b cross join lateral regexp_split_to_table(replace(b.tables,'+',','),',') p(id) where b.status not in ('cancelled','no_show') and coalesce(b.tables,'')<>'') select count(*) from x a join x b on a.booking_date=b.booking_date and a.physical_id=b.physical_id and a.id<b.id""").fetchone()[0]
            assert dinner_people == 25 and after_people == 25 and shared == 0, (dinner_people, after_people, shared)
            assert dict(independent_people) == {"normale": 25, "dopocena": 1}, independent_people
            # Rehearse restoration of the live definitions on this disposable copy.
            baseline = json.loads((ROOT / "docs/complete-booking-system-live-baseline.json").read_text())
            with psycopg.connect(connect) as conn:
                with conn.transaction():
                    conn.execute("select pg_advisory_xact_lock(734512)")
                    conn.execute("drop trigger zzz_rebalance_booking_event on public.bookings")
                    for item in baseline["functions"]:
                        conn.execute(item["definition"])
                    previous_capacity = next(item for item in baseline["additional_prerequisite_and_security_functions"] if item["function_name"] == "private.service_capacity")
                    conn.execute(previous_capacity["definition"])
                    old_trigger = next(item for item in baseline["triggers"] if item["trigger_name"] == "y_enforce_daily_booking_capacity_25")
                    conn.execute(old_trigger["definition"])
                    old_check = next(item for item in baseline["constraints"] if item["constraint_name"] == "booking_communications_kind_check")
                    conn.execute("alter table public.booking_communications drop constraint booking_communications_kind_check")
                    conn.execute(f"alter table public.booking_communications add constraint booking_communications_kind_check {old_check['definition']}")
                assert conn.execute("select count(*) from pg_trigger where tgname='y_enforce_daily_booking_capacity_25'").fetchone()[0] == 1
                assert conn.execute("select count(*) from pg_trigger where tgname='zzz_rebalance_booking_event'").fetchone()[0] == 0
                assert not conn.execute("select has_table_privilege('authenticated','public.bookings','DELETE')").fetchone()[0]
            print(json.dumps({"last_dinner_table": last_table, "after_dinner_25": after_limit, "same_table": same_table, "cancel_and_replace": outcomes, "dinner_people": dinner_people, "after_people": after_people, "independent_service_quotas": dict(independent_people), "shared_physical_tables": shared, "rollback_definitions_rehearsed": True, "postgresql": "17"}, sort_keys=True))
        finally:
            run(str(BIN / "pg_ctl"), "-D", str(data), "-m", "immediate", "stop")


if __name__ == "__main__":
    main()
