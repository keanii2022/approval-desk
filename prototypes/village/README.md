# Village prototype

A playable, pixel-art picture of how Approval Desk works: a robot agent carries a
refund request from the Inbox to the gate, the gate shows green, yellow or red,
a human decides big refunds at the desk, the factory pays, and the logbook keeps
the record.

This is a throwaway reference for Step 11 (see `docs/PLAN.md`). Step 11 rebuilds it
properly inside the app, on live data. Until then it runs on scripted, invented data.

Open `index.html` in a browser. No install, no network, no API key.

- Scenes: keys 1, 2, 3 (small refund, big refund, silly refund)
- Human desk: A to approve, R to reject (it always waits for a person)
- Logbook: click it, or press L
- Speed button, Space to pause, N for day, M for sound

All art is drawn by the code. Nothing is copied from any game.
