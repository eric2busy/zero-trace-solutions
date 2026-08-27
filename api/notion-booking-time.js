/**
 * Notion rejects date values that combine an explicit `time_zone` with a
 * non-zero UTC offset. Keep the selected wall-clock values offset-free and let
 * Notion interpret them in the supplied IANA timezone.
 */
function confirmedTimeSlotDate(start, end, timeZone) {
  return { start, end, time_zone: timeZone };
}

module.exports = { confirmedTimeSlotDate };
