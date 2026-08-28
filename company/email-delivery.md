# Transactional email delivery

The application uses Resend for transactional delivery. `LEAD_ALERT_FROM` selects the sending identity and `LEAD_ALERT_TO` selects the internal alert/reply address; both have code defaults. `RESEND_API_KEY` is required to send and must remain a Vercel secret.

Resend delivery and Proton inbound mail are separate concerns. Do not change DNS, Proton configuration, or the Resend sending configuration as part of normal application maintenance. Any configuration change requires explicit owner approval.

## Runtime behavior

After a lead is safely created in Notion or a booking is safely created in Calendar and updated in Notion, the application attempts its customer and internal emails. Each attempt produces a structured `transactional_email_delivery` runtime log with only endpoint, message type, recipient category, outcome, and provider status when available. It never includes an email address, mail content, API key, or provider response body.

Successful `/api/leads` and `/api/book` responses include `emailDelivery.customer` and `emailDelivery.internal` metadata. Possible delivery reasons are `accepted`, `provider_rejected`, `resend_not_configured`, `missing_recipient`, and `request_failed`. A failed delivery does not reverse an otherwise-successful lead or booking.

## Safe rollback

Revert the observability change through the reviewed application PR if needed. Do not remove or rotate `RESEND_API_KEY`, alter DNS, or change Proton while rolling back unless the owner explicitly approves that separate action.
