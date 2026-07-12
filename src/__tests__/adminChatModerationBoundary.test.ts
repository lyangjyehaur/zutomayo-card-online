import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('admin chat moderation boundary', () => {
  it('keeps the admin console wired to durable chat evidence and sanctions', () => {
    const adminSource = readRepoFile('src/pages/AdminPage.tsx');
    const apiClientSource = readRepoFile('src/api/client.ts');

    expect(adminSource).toContain('adminGetChatReports');
    expect(adminSource).toContain('adminGetChatConversationMessages');
    expect(adminSource).toContain('adminCreateChatUserSanction');
    expect(adminSource).toContain('adminRevokeChatUserSanction');
    expect(adminSource).toContain('adminReviewChatMessageModeration');
    expect(apiClientSource).toContain('/admin/chat/reports');
    expect(apiClientSource).toContain('/admin/chat/conversations/');
    expect(apiClientSource).toContain('/admin/chat/sanctions');
    expect(apiClientSource).toContain('/admin/chat/messages/');
  });

  it('loads full conversation context instead of relying only on report snapshots', () => {
    const adminSource = readRepoFile('src/pages/AdminPage.tsx');
    const loadEvidenceStart = adminSource.indexOf('const loadChatEvidence =');
    const loadEvidenceEnd = adminSource.indexOf('const moderateChatMessage =');
    const loadEvidenceSource = adminSource.slice(loadEvidenceStart, loadEvidenceEnd);

    expect(loadEvidenceStart).toBeGreaterThan(-1);
    expect(loadEvidenceEnd).toBeGreaterThan(loadEvidenceStart);
    expect(loadEvidenceSource).toContain('adminGetChatConversationMessages(token, report.conversationId, 100)');
    expect(loadEvidenceSource).toContain('setChatEvidence(evidence)');
    expect(loadEvidenceSource).toContain('setChatEvidenceFocusMessageId(report.messageId)');
    expect(adminSource).toContain('chatEvidence.messages.map((message)');
    expect(adminSource).toContain("message.deletedAt ? 'deleted' : message.moderationStatus");
    expect(adminSource).toContain('message.moderationReason');
  });

  it('lets admins moderate hidden messages and mute or unmute the reported author from evidence', () => {
    const adminSource = readRepoFile('src/pages/AdminPage.tsx');
    const moderationStart = adminSource.indexOf('const moderateChatMessage =');
    const muteStart = adminSource.indexOf('const muteReportedAuthor =');
    const revokeStart = adminSource.indexOf('const revokeChatSanction =');
    const moderationSource = adminSource.slice(moderationStart, muteStart);
    const muteSource = adminSource.slice(muteStart, revokeStart);
    const revokeSource = adminSource.slice(revokeStart, adminSource.indexOf('const loadAdminCards ='));

    expect(moderationSource).toContain("status: 'visible' | 'blocked' | 'deleted'");
    expect(moderationSource).toContain('adminReviewChatMessageModeration(token, message.id, { status, reason })');
    expect(moderationSource).toContain('adminGetChatConversationMessages(token, chatEvidence.conversation.id, 100)');
    expect(moderationSource).toContain('adminGetChatReports(token, chatReportStatus)');
    expect(adminSource).toContain("moderateChatMessage(message, 'visible')");
    expect(adminSource).toContain("moderateChatMessage(message, 'blocked')");
    expect(adminSource).toContain("moderateChatMessage(message, 'deleted')");

    expect(muteSource).toContain('const targetUserId = report.message?.authorUserId');
    expect(muteSource).toContain("type: 'chat_mute'");
    expect(muteSource).toContain('durationMinutes: 1440');
    expect(muteSource).toContain('sourceReportId: report.id');
    expect(muteSource).toContain('sourceMessageId: report.messageId');
    expect(muteSource).toContain('conversationId: report.conversationId');

    expect(revokeSource).toContain('const sanctionId = report.message?.activeSanction?.id');
    expect(revokeSource).toContain('adminRevokeChatUserSanction(token, sanctionId)');
    expect(adminSource).toContain('report.message?.activeSanction');
    expect(adminSource).toContain('已禁言至');
    expect(adminSource).toContain('解除禁言');
    expect(adminSource).toContain('禁言 24h');
  });
});
