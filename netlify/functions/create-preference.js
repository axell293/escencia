// Netlify Function: crea una preferencia de pago en Mercado Pago
// El Access Token vive SOLO en las variables de entorno de Netlify (MP_ACCESS_TOKEN),
// nunca en el código del sitio ni visible al público.

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Falta configurar MP_ACCESS_TOKEN en Netlify (Environment variables).' }),
    };
  }

  try {
    const { items, customer } = JSON.parse(event.body || '{}');

    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Carrito vacío o inválido.' }) };
    }

    // Reconstruimos los items en el servidor (nunca confiamos en precios que vengan del navegador)
    const mpItems = items.map((it) => ({
      title: `${it.name} (${it.size})`,
      quantity: Number(it.qty) || 1,
      unit_price: Number(it.price),
      currency_id: 'MXN',
    }));

    const siteUrl = event.headers.origin || `https://${event.headers.host}`;

    const preference = {
      items: mpItems,
      payer: customer && customer.name ? { name: customer.name, phone: { number: customer.phone || '' } } : undefined,
      back_urls: {
        success: `${siteUrl}/?pago=exito`,
        failure: `${siteUrl}/?pago=fallido`,
        pending: `${siteUrl}/?pago=pendiente`,
      },
      auto_return: 'approved',
      statement_descriptor: 'ESCENCIA PERFUMES',
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    });

    const data = await mpRes.json();

    if (!mpRes.ok) {
      return { statusCode: mpRes.status, headers, body: JSON.stringify({ error: data.message || 'Error de Mercado Pago', detail: data }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ init_point: data.init_point, id: data.id }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
