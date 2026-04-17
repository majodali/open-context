import { describe, it, expect } from 'vitest';
import {
  OpenContext,
  DeterministicEmbedder,
  WriteAccessError,
} from '../src/index.js';

describe('Governance: write rules', () => {
  it('unrestricted context allows any agent to write', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({
      name: 'Open',
      description: 'No restrictions',
      writeRules: { writers: [] }, // empty = unrestricted
    });

    // Should succeed — no restrictions
    const units = await oc.acquire('Anyone can write here.', ctx.id, {
      createdBy: 'agent-x',
    });
    expect(units.length).toBeGreaterThan(0);
  });

  it('restricted context blocks unauthorized agents', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({
      name: 'Restricted',
      description: 'Only auth-agent can write',
      writeRules: { writers: ['auth-agent'] },
    });

    // Should fail — agent-x is not in the writers list
    await expect(
      oc.acquire('Unauthorized write.', ctx.id, { createdBy: 'agent-x' }),
    ).rejects.toThrow(WriteAccessError);
  });

  it('restricted context allows authorized agents', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({
      name: 'Restricted',
      description: 'Only auth-agent can write',
      writeRules: { writers: ['auth-agent'] },
    });

    // Should succeed — auth-agent is allowed
    const units = await oc.acquire('Authorized write.', ctx.id, {
      createdBy: 'auth-agent',
    });
    expect(units.length).toBeGreaterThan(0);
  });

  it('content type restrictions are enforced', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({
      name: 'Facts Only',
      description: 'Only facts allowed',
      writeRules: { writers: [], allowedContentTypes: ['fact', 'statement'] },
    });

    // Should fail — configuration not in allowed list
    await expect(
      oc.acquire('config: test', ctx.id, {
        createdBy: 'agent-a',
        contentType: 'configuration',
      }),
    ).rejects.toThrow(WriteAccessError);

    // Should succeed — fact is allowed
    const units = await oc.acquire('Water boils at 100C.', ctx.id, {
      createdBy: 'agent-a',
      contentType: 'fact',
    });
    expect(units.length).toBeGreaterThan(0);
  });

  it('acquisition without createdBy skips write rule enforcement', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });
    const ctx = await oc.createContext({
      name: 'Restricted',
      description: 'Only specific agent',
      writeRules: { writers: ['specific-agent'] },
    });

    // No createdBy — skips enforcement (backward compatible)
    const units = await oc.acquire('Legacy write without agent ID.', ctx.id);
    expect(units.length).toBeGreaterThan(0);
  });
});

describe('Governance: proposals', () => {
  it('creates a proposal targeting another context', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });

    const root = await oc.createContext({
      name: 'Root',
      description: 'Root context',
    });
    const auth = await oc.createContext({
      name: 'Auth',
      description: 'Auth module',
      parentId: root.id,
    });

    // Auth agent proposes a change to root
    const proposals = await oc.createProposal(
      auth.id,
      root.id,
      'Proposed: increase default siblingWeight from 0.5 to 0.7 to improve cross-module discovery.',
      'auth-agent',
    );

    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].metadata.contentType).toBe('proposal');
    expect(proposals[0].contextId).toBe(auth.id); // Written to auth, not root
    expect(proposals[0].metadata.tags).toContain(`proposal-target:${root.id}`);
  });

  it('retrieves pending proposals for a target context', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });

    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    const auth = await oc.createContext({
      name: 'Auth', description: 'Auth', parentId: root.id,
    });
    const payments = await oc.createContext({
      name: 'Payments', description: 'Payments', parentId: root.id,
    });

    // Both child agents propose changes to root
    await oc.createProposal(auth.id, root.id, 'Auth proposal: add MFA support.');
    await oc.createProposal(payments.id, root.id, 'Payments proposal: add refund flow.');

    const pending = await oc.getPendingProposals(root.id);
    expect(pending).toHaveLength(2);
  });

  it('resolves a proposal (approve/reject)', async () => {
    const oc = new OpenContext({ embedder: new DeterministicEmbedder(64) });

    const root = await oc.createContext({ name: 'Root', description: 'Root' });
    const auth = await oc.createContext({
      name: 'Auth', description: 'Auth', parentId: root.id,
    });

    const proposals = await oc.createProposal(auth.id, root.id, 'Test proposal.');
    const proposalId = proposals[0].id;

    await oc.resolveProposal(proposalId, 'approved');

    const unit = await oc.unitStore.get(proposalId);
    expect(unit!.metadata.proposalStatus).toBe('approved');
    expect(unit!.metadata.tags).toContain('status:approved');
    expect(unit!.metadata.tags).not.toContain('status:pending');
  });
});
