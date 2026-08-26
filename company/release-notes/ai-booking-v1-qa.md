# Zero Touch Booking v1 — QA

Validated:
- Preview deployment builds on Vercel.
- `/api/availability` returns HTTP 200 against the deployed preview.
- Availability is sourced from the configured Google Calendar.
- Lead intake no longer creates calendar events.
- Confirmed booking re-checks availability before inserting an event.
- Booking updates Notion status to Scheduled.
- Calendar event is rolled back if the Notion booking update fails.
- Past slots are rejected.
- Pacific timezone and DST offsets are resolved dynamically in the backend.
- Customer confirmation display no longer assumes a fixed UTC offset.

Production smoke test after merge:
- Verify `book.html` loads.
- Verify availability endpoint returns slots.
- Submit one owner-controlled walkthrough booking through the live UI and confirm Notion, Calendar, and email side effects.
