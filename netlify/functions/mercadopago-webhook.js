// Netlify Function: recibe la notificación (webhook) de Mercado Pago cuando cambia
// el estado de un pago, obtiene los datos completos del pago y del cliente
// (guardados como "metadata" al crear la preferencia), y los reenvía a Google
// Sheets / correo para que el dueño del negocio se entere del pedido completo,
// más allá del aviso genérico que da la app de Mercado Pago.

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbwa9NFkZtG_EDeRnHsY9bGuykxaB-Yxv8qfm-NYy5lAXXjnKsixTsz25e_2FLXIOQ/exec";

  if (!ACCESS_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Falta MP_ACCESS_TOKEN' }) };
  }

  try {
    // Mercado Pago manda el aviso por query params (?type=payment&data.id=123) o por body JSON,
    // según la versión de notificación. Cubrimos ambos casos.
    const params = event.queryStringParameters || {};
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) { /* body vacío o no-JSON, ignorar */ }

    const topic = params.type || params.topic || body.type || body.topic;
    const paymentId = params['data.id'] || (body.data && body.data.id) || params.id;

    // Si no es una notificación de pago, respondemos OK sin hacer nada (evita reintentos de MP)
    if (topic !== 'payment' || !paymentId) {
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    // Pedimos el detalle completo del pago a Mercado Pago
    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    const payment = await payRes.json();

    if (!payRes.ok) {
      // Respondemos 200 igual para que MP no siga reintentando por un pago que no existe/expiró
      return { statusCode: 200, headers, body: JSON.stringify({ received: true, warning: 'payment fetch failed' }) };
    }

    // Solo notificamos cuando el pago ya está aprobado (dinero confirmado)
    if (payment.status !== 'approved') {
      return { statusCode: 200, headers, body: JSON.stringify({ received: true, status: payment.status }) };
    }

    const meta = payment.metadata || {};

    const notification = {
      type: 'pedido',
      payment_id: payment.id,
      total: payment.transaction_amount,
      metodo: 'Mercado Pago (tarjeta)',
      productos: meta.order_summary || '',
      name: meta.customer_name || (payment.payer && payment.payer.first_name) || '',
      phone: meta.customer_phone || '',
      address: meta.customer_address || '',
      city: meta.customer_city || '',
      zip: meta.customer_zip || '',
      email: meta.customer_email || (payment.payer && payment.payer.email) || '',
    };

    // Reenviamos el pedido completo a tu Google Apps Script (agrega fila + te manda correo)
    if (GOOGLE_SHEET_URL) {
      await fetch(GOOGLE_SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notification),
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ received: true, notified: true }) };
  } catch (err) {
    // Siempre respondemos 200 a Mercado Pago para que no reintente indefinidamente un error nuestro
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, error: err.message }) };
  }
};
