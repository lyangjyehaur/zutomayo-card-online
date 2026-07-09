import { describe, expect, it } from 'vitest';
import {
  buildDirectConversationSubjectId,
  directConversationPeerId,
  normalizeDirectChatUserId,
} from '../chat/directConversation';

describe('direct conversation helpers', () => {
  it('normalizes direct chat user ids', () => {
    expect(normalizeDirectChatUserId(' user:abc_123-xyz ')).toBe('user:abc_123-xyz');
    expect(normalizeDirectChatUserId('ab')).toBe('');
    expect(normalizeDirectChatUserId('user@example.com')).toBe('');
    expect(normalizeDirectChatUserId(null)).toBe('');
  });

  it('builds a canonical subject id for both participants', () => {
    expect(buildDirectConversationSubjectId('u_b', 'u_a')).toBe('v1:u_a:u_b');
    expect(buildDirectConversationSubjectId('u_a', 'u_b')).toBe('v1:u_a:u_b');
    expect(buildDirectConversationSubjectId('logto:user_b', 'u_a')).toBe('v1:logto%3Auser_b:u_a');
    expect(buildDirectConversationSubjectId('u_a', 'u_a')).toBeNull();
    expect(buildDirectConversationSubjectId('u_a', 'bad user')).toBeNull();
  });

  it('extracts the peer id from a direct conversation subject', () => {
    expect(directConversationPeerId('v1:u_a:u_b', 'u_a')).toBe('u_b');
    expect(directConversationPeerId('v1:u_a:u_b', 'u_b')).toBe('u_a');
    expect(directConversationPeerId('v1:logto%3Auser_b:u_a', 'logto:user_b')).toBe('u_a');
    expect(directConversationPeerId('u_a:u_b', 'u_a')).toBe('u_b');
    expect(directConversationPeerId('u_a:u_b', 'u_c')).toBeNull();
    expect(directConversationPeerId('u_a:u_b:u_c', 'u_a')).toBeNull();
  });
});
