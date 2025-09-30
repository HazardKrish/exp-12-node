const axios = require('axios');

const BASE = process.env.BASE || 'http://localhost:3000';
const seatId = 1;

async function runConcurrentLockedAttempts() {
  const tries = [ 'alice', 'bob', 'carol', 'dan', 'eve' ];
  const promises = tries.map(userId =>
    axios.post(`${BASE}/seats/${seatId}/lock`, { userId }).then(
      r => ({ userId, status: 'success', data: r.data }),
      e => ({ userId, status: 'error', error: e.response ? e.response.data : e.message })
    )
  );
  const results = await Promise.all(promises);
  console.log('Concurrent lock attempt results:');
  results.forEach(r => {
    console.log(r.userId, '->', r.status, r.status === 'success' ? r.data : r.error);
  });
  const winner = results.find(r => r.status === 'success');
  if (winner) {
    const { userId, data } = winner;
    console.log(`\nNow let ${userId} confirm using token...`);
    const confirm = await axios.post(`${BASE}/seats/${seatId}/confirm`, { userId, lockToken: data.lockToken })
      .then(r => ({ ok: true, data: r.data }), e => ({ ok: false, err: e.response ? e.response.data : e.message }));
    console.log('Confirm result:', confirm);
  } else {
    console.log('No one acquired lock in concurrency test.');
  }
}

runConcurrentLockedAttempts().catch(err => console.error(err));
