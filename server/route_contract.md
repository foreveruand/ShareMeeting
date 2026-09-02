# Self-Hosted Mini Program Route Contract

The self-hosted API must provide these routes used by the visible meeting-room flows. A response with code `1600` for any entry indicates a deployment/version mismatch and must be fixed on the server, not suppressed by the Mini Program.

| Flow | Routes |
| --- | --- |
| Personal profile | `passport/my_detail` |
| Meeting-room list and detail | `enroll/list`, `enroll/view`, `enroll/day`, `enroll/detail_for_join` |
| Meeting calendar | `enroll/all_has_day`, `enroll/all_day` |
| My reservations | `enroll/my_join_list`, `enroll/my_join_detail`, `enroll/my_join_cancel` |
| Create or edit a reservation | `enroll/join`, `enroll/join_edit` |

`server/test/app.test.js` exercises the displayed read flows and reservation creation. The edit tests cover successful time changes, a cross-date change, conflict rejection, and the existing edit-permission rules.
