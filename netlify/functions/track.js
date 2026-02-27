exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { tracking } = JSON.parse(event.body || '{}');
    if (!tracking) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing tracking number' }) };

    const apiKey = process.env.TRACK17_API_KEY;

    // Detect carrier — Gaash Worldwide uses GWD prefix (carrier code 190460 on 17track)
    const isGaash = tracking.toUpperCase().startsWith('GWD');
    const registerPayload = isGaash
      ? [{ number: tracking, carrier: 190460 }]
      : [{ number: tracking }];
    const getPayload = isGaash
      ? [{ number: tracking, carrier: 190460 }]
      : [{ number: tracking }];

    // Step 1: Register tracking number
    await fetch('https://api.17track.net/track/v2.2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', '17token': apiKey },
      body: JSON.stringify(registerPayload)
    });

    // Step 2: Get tracking info
    const res = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', '17token': apiKey },
      body: JSON.stringify(getPayload)
    });

    const data = await res.json();
    const item = data?.data?.accepted?.[0];

    if (!item) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false }) };
    }

    const track = item.track;
    const events = (track?.tracking?.providers?.[0]?.events || []).map(ev => ({
      date: ev.time_iso || ev.time,
      status: ev.description,
      location: ev.location || ''
    }));

    const statusMap = {
      0: 'לא נמצא', 10: 'בתהליך', 20: 'נשלח', 30: 'במעבר',
      35: 'עצירה לא צפויה', 40: 'יצא למסירה', 41: 'ניסיון מסירה נכשל',
      42: 'זמין לאיסוף', 43: 'מוחזר לשולח', 50: 'נמסר', 60: 'פג תוקף'
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: events.length > 0,
        carrier: isGaash ? 'Gaash Worldwide' : (track?.carrier_code || ''),
        statusCode: track?.status,
        statusText: statusMap[track?.status] || 'בדרך',
        delivered: track?.status === 50,
        events
      })
    };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
