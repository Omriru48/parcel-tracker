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
    const isGaash = tracking.toUpperCase().startsWith('GWD');

    // Step 1: Register (no carrier hint — let 17track auto-detect, works better)
    const regRes = await fetch('https://api.17track.net/track/v2.2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', '17token': apiKey },
      body: JSON.stringify([{ number: tracking }])
    });
    const regData = await regRes.json();
    console.log('Register response:', JSON.stringify(regData));

    // Step 2: Get tracking info
    const res = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', '17token': apiKey },
      body: JSON.stringify([{ number: tracking }])
    });

    const data = await res.json();
    console.log('Track response:', JSON.stringify(data).substring(0, 500));

    // Check both accepted and rejected
    const item = data?.data?.accepted?.[0] || data?.data?.rejected?.[0];

    if (!item) {
      return { statusCode: 200, headers, body: JSON.stringify({ found: false, debug: data }) };
    }

    const track = item.track;
    const providers = track?.tracking?.providers || [];
    
    // Collect events from all providers
    let events = [];
    for (const provider of providers) {
      const provEvents = (provider.events || []).map(ev => ({
        date: ev.time_iso || ev.time,
        status: ev.description,
        location: ev.location || ''
      }));
      events = events.concat(provEvents);
    }

    // Sort by date descending
    events.sort((a, b) => new Date(b.date) - new Date(a.date));

    const statusMap = {
      0: 'לא נמצא', 10: 'בתהליך', 20: 'נשלח', 30: 'במעבר',
      35: 'עצירה לא צפויה', 40: 'יצא למסירה', 41: 'ניסיון מסירה נכשל',
      42: 'זמין לאיסוף', 43: 'מוחזר לשולח', 50: 'נמסר', 60: 'פג תוקף'
    };

    const statusCode = track?.status ?? track?.w1;
    const carrierName = isGaash ? 'Gaash Worldwide' : (track?.carrier_name || track?.w3 || '');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        found: true,
        carrier: carrierName,
        statusCode,
        statusText: statusMap[statusCode] || 'בדרך',
        delivered: statusCode === 50,
        events
      })
    };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
