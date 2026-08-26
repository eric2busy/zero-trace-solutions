# Zero Touch Booking v1

Status: release candidate

This release separates lead intake from confirmed scheduling and adds verified Google Calendar availability.

Flow:
1. Customer submits walkthrough details.
2. Lead is stored in Notion with status New.
3. Website queries real calendar availability.
4. Customer selects a returned slot.
5. Booking endpoint re-checks the slot before committing.
6. Confirmed event is created in Google Calendar.
7. Notion lead is updated to Scheduled.
8. Customer and internal confirmation emails are sent.

Safety:
- Preferred time is not treated as a booking.
- Calendar writes only happen after explicit customer slot confirmation.
- Notion failure after event creation triggers calendar rollback.
- Past slots are rejected.
- Pacific timezone/DST is resolved dynamically.
