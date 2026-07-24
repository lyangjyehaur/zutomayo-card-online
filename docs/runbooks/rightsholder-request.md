# Rightsholder And Trust Request Runbook

Public contact: `contact@mail.zutomayocard.online`

Operator: ZUTOMAYO CARD ONLINE Community

## Scope

This runbook covers:

- Card image, name, trademark, rules text, translation, or other rightsholder notices.
- Privacy export/deletion requests that cannot be completed in Profile.
- Moderation appeals and sensitive security reports sent to the public contact address.

## Intake

1. Record received UTC, sender, subject category, affected URL/card/content, requested action, and assigned operator.
2. Keep the original message and attachments private. Do not copy identity documents or private data into a public issue.
3. Acknowledge receipt. Ask only for information needed to confirm the request and the sender's authority.
4. For a rightsholder request, collect the claimed rights basis, affected material, requested action, and a statement that the sender is authorized and the information is accurate.

## Triage

- **Urgent:** credible active security exposure, illegal content, or a clear request from an identifiable rightsholder. Restrict access or temporarily hide affected content before completing the investigation when necessary.
- **Normal:** privacy, moderation appeal, or ownership question without immediate harm. Assign an owner and record the next action.
- **Insufficient:** request lacks affected material or a usable reply address. Ask for clarification without disclosing player data.

## Mitigation

Use the smallest reversible action that addresses the notice:

1. Disable or replace the affected card image/content through the admin card configuration or deployment asset configuration.
2. If the scope cannot be isolated safely, disable the affected public route or asset origin until a release fix is available.
3. Purge CDN/browser cache where applicable and verify the content is no longer publicly returned.
4. Preserve the request, decision, operator, timestamps, before/after URLs, release SHA, and verification evidence.

Do not delete audit or request evidence that is subject to an active dispute or legal hold.

## Resolution

1. Confirm whether content was retained, modified, restricted, or removed and why.
2. Reply to the requester without exposing private player, admin, or infrastructure information.
3. Update the policy decision if the request changes the accepted use boundary.
4. Create a private incident/release record for any production change and verify the site after deployment.

## Release Rehearsal

Before Public Beta:

1. Send one controlled message to `contact@mail.zutomayocard.online` from an unrelated mailbox.
2. Confirm delivery to the assigned operator and record received UTC.
3. Walk through a fictional single-card image request without changing production.
4. Record acknowledgment, triage, proposed mitigation, responder, and completion time.
5. Attach the redacted rehearsal record to RR-01 release evidence.
