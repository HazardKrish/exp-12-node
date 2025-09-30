const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const LOCK_TIMEOUT_MS = Number(process.env.LOCK_TIMEOUT_MS) || 60_000;

const seats = new Map();

function createSeats() {
  let id = 1;
  const rows = ['A', 'B'];
  const perRow = 6;
  rows.forEach(row => {
    for (let n = 1; n <= perRow; n++) {
      seats.set(id, {
        id,
        row,
        number: n,
        status: 'available',
        lockedBy: null,
        lockToken: null,
        lockExpiresAt: null,
        lockTimer: null
      });
      id++;
    }
  });
}
createSeats();

function getSeat(id) {
  return seats.get(id);
}

function clearLockTimer(seat) {
  if (seat.lockTimer) {
    clearTimeout(seat.lockTimer);
    seat.lockTimer = null;
  }
}

function unlockSeat(seat, reason = 'manual') {
  clearLockTimer(seat);
  seat.status = 'available';
  seat.lockedBy = null;
  seat.lockToken = null;
  seat.lockExpiresAt = null;
  console.log(`Seat ${seat.id} unlocked (${reason})`);
}

function scheduleAutoUnlock(seat, ms) {
  clearLockTimer(seat);
  seat.lockTimer = setTimeout(() => {
    if (seat.status === 'locked' && seat.lockExpiresAt && Date.now() >= seat.lockExpiresAt) {
      unlockSeat(seat, 'timeout');
    }
  }, ms);
}

app.get('/seats', (req, res) => {
  res.json(Array.from(seats.values()).map(s => ({
    id: s.id,
    row: s.row,
    number: s.number,
    status: s.status,
    lockedBy: s.lockedBy,
    lockExpiresAt: s.lockExpiresAt ? new Date(s.lockExpiresAt).toISOString() : null
  })));
});

app.get('/seats/:id', (req, res) => {
  const id = Number(req.params.id);
  const seat = getSeat(id);
  if (!seat) return res.status(404).json({ error: 'Seat not found' });
  res.json({
    id: seat.id,
    row: seat.row,
    number: seat.number,
    status: seat.status,
    lockedBy: seat.lockedBy,
    lockExpiresAt: seat.lockExpiresAt ? new Date(seat.lockExpiresAt).toISOString() : null
  });
});

app.post('/seats/:id/lock', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required in body' });

  const seat = getSeat(id);
  if (!seat) return res.status(404).json({ error: 'Seat not found' });

  if (seat.status === 'booked') {
    return res.status(409).json({ error: 'Seat already booked' });
  }

  if (seat.status === 'locked') {
    if (seat.lockExpiresAt && Date.now() > seat.lockExpiresAt) {
      unlockSeat(seat, 'expired-detected-on-lock');
    } else {
      return res.status(409).json({ error: 'Seat is currently locked' });
    }
  }

  const lockToken = uuidv4();
  seat.status = 'locked';
  seat.lockedBy = userId;
  seat.lockToken = lockToken;
  seat.lockExpiresAt = Date.now() + LOCK_TIMEOUT_MS;
  scheduleAutoUnlock(seat, LOCK_TIMEOUT_MS);

  res.status(201).json({
    message: 'Seat locked',
    seatId: seat.id,
    lockedBy: seat.lockedBy,
    lockToken: seat.lockToken,
    expiresAt: new Date(seat.lockExpiresAt).toISOString()
  });
});

app.post('/seats/:id/confirm', (req, res) => {
  const id = Number(req.params.id);
  const { userId, lockToken } = req.body;
  if (!userId || !lockToken) return res.status(400).json({ error: 'userId and lockToken are required' });

  const seat = getSeat(id);
  if (!seat) return res.status(404).json({ error: 'Seat not found' });

  if (seat.status !== 'locked') {
    return res.status(409).json({ error: 'Seat is not locked; cannot confirm' });
  }

  if (seat.lockExpiresAt && Date.now() > seat.lockExpiresAt) {
    unlockSeat(seat, 'expired-detected-on-confirm');
    return res.status(410).json({ error: 'Lock has expired' });
  }

  if (seat.lockedBy !== userId || seat.lockToken !== lockToken) {
    return res.status(403).json({ error: 'Invalid lock token or user mismatch' });
  }

  clearLockTimer(seat);
  seat.status = 'booked';
  seat.lockedBy = null;
  seat.lockToken = null;
  seat.lockExpiresAt = null;

  res.json({
    message: 'Seat successfully booked',
    seatId: seat.id,
    row: seat.row,
    number: seat.number
  });
});

app.post('/seats/:id/unlock', (req, res) => {
  const id = Number(req.params.id);
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const seat = getSeat(id);
  if (!seat) return res.status(404).json({ error: 'Seat not found' });

  if (seat.status !== 'locked') return res.status(400).json({ error: 'Seat is not locked' });

  if (seat.lockedBy !== userId) return res.status(403).json({ error: 'Only the locker can unlock the seat' });

  unlockSeat(seat, 'manual-unlock');
  res.json({ message: 'Seat unlocked' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ticket booking API listening on http://localhost:${PORT}`);
  console.log(`Lock timeout = ${LOCK_TIMEOUT_MS / 1000}s`);
});
