import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { Webhook } from 'npm:svix';

const MAX_BODY_BYTES = 64 * 1024;

const EVENT_STATUS: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

function respond(
  body: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'Content-Type':
          'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(status === 405
          ? { Allow: 'POST' }
          : {}),
      },
    },
  );
}

async function readRawBody(
  request: Request,
): Promise<string> {
  const reader =
    request.body?.getReader();

  if (!reader) {
    throw new Error(
      'missing_body',
    );
  }

  const decoder =
    new TextDecoder();

  let raw = '';
  let size = 0;

  while (true) {
    const {
      value,
      done,
    } = await reader.read();

    if (done) break;

    size += value.byteLength;

    if (
      size
      > MAX_BODY_BYTES
    ) {
      await reader.cancel();

      throw new Error(
        'body_too_large',
      );
    }

    raw += decoder.decode(
      value,
      { stream: true },
    );
  }

  raw += decoder.decode();

  return raw;
}

export async function handler(
  request: Request,
): Promise<Response> {
  if (
    request.method
    !== 'POST'
  ) {
    return respond(
      {
        error:
          'Metodo non consentito',
      },
      405,
    );
  }

  const url =
    Deno.env.get(
      'SUPABASE_URL',
    );

  const serviceKey =
    Deno.env.get(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

  const webhookSecret =
    Deno.env.get(
      'RESEND_WEBHOOK_SECRET',
    );

  if (
    !url
    || !serviceKey
    || !webhookSecret
  ) {
    return respond(
      {
        error:
          'Webhook non configurato',
      },
      503,
    );
  }

  let raw: string;

  try {
    raw =
      await readRawBody(
        request,
      );
  } catch (error) {
    if (
      error instanceof Error
      && error.message
        === 'body_too_large'
    ) {
      return respond(
        {
          error:
            'Richiesta troppo grande',
        },
        413,
      );
    }

    return respond(
      {
        error:
          'Payload mancante',
      },
      400,
    );
  }

  const svixId =
    request.headers.get(
      'svix-id',
    );

  const svixTimestamp =
    request.headers.get(
      'svix-timestamp',
    );

  const svixSignature =
    request.headers.get(
      'svix-signature',
    );

  if (
    !svixId
    || !svixTimestamp
    || !svixSignature
  ) {
    return respond(
      {
        error:
          'Firma webhook mancante',
      },
      400,
    );
  }

  let event: any;

  try {
    const webhook =
      new Webhook(
        webhookSecret,
      );

    webhook.verify(
      raw,
      {
        'svix-id':
          svixId,
        'svix-timestamp':
          svixTimestamp,
        'svix-signature':
          svixSignature,
      },
    );

    event = JSON.parse(raw);
  } catch {
    return respond(
      {
        error:
          'Firma webhook non valida',
      },
      400,
    );
  }

  if (
    !event
    || typeof event
      !== 'object'
    || Array.isArray(event)
  ) {
    return respond(
      {
        error:
          'Evento non valido',
      },
      400,
    );
  }

  const type =
    typeof event.type
      === 'string'
      ? event.type
      : '';

  const status =
    EVENT_STATUS[type];

  // Eventi Resend non usati da Agenda:
  // vengono riconosciuti ma ignorati.
  if (!status) {
    return respond({
      ok: true,
      ignored: true,
    });
  }

  const emailId =
    typeof event.data
      ?.email_id
      === 'string'
      ? event.data.email_id
      : '';

  if (
    !emailId
    || emailId.length > 200
  ) {
    return respond(
      {
        error:
          'Email ID non valido',
      },
      400,
    );
  }

  let errorCode:
    string | null = null;

  if (
    type
      === 'email.bounced'
  ) {
    const bounceType =
      event.data?.bounce
        ?.type;

    const bounceSubtype =
      event.data?.bounce
        ?.subType;

    errorCode = [
      'bounce',
      typeof bounceType
        === 'string'
        ? bounceType
        : null,
      typeof bounceSubtype
        === 'string'
        ? bounceSubtype
        : null,
    ]
      .filter(Boolean)
      .join(':')
      .slice(0, 250);
  } else if (
    type
      === 'email.complained'
  ) {
    errorCode =
      'complaint';
  }

  const client =
    createClient(
      url,
      serviceKey,
      {
        auth: {
          persistSession:
            false,
          autoRefreshToken:
            false,
        },
      },
    );

  const {
    data,
    error,
  } = await client.rpc(
    'record_booking_email_provider_event',
    {
      p_provider_id:
        emailId,
      p_status:
        status,
      p_error_code:
        errorCode,
    },
  );

  if (error) {
    console.error(
      JSON.stringify({
        event:
          'resend_webhook_db_error',
        type,
      }),
    );

    return respond(
      {
        error:
          'Errore interno',
      },
      500,
    );
  }

  return respond({
    ok: true,
    result: data,
  });
}

if (import.meta.main) {
  Deno.serve(handler);
}
