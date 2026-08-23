import { describe, expect, it } from 'vitest';
import { createPreviewAmendment } from './fixtures.js';
import { isAmendmentApplicable, requiresScopeDecision, type PreviewContextScope } from './types.js';

const scope: PreviewContextScope = {
  businessVersionId: 'bv-checkout-34',
  businessVersionLabel: 'checkout-release-3.4',
  deployment: 'staging@8f12cd',
  pageDefinitionId: 'page-checkout',
  pageLabel: '订单结算页',
  url: 'https://staging.shop.example/checkout/cart_8A21',
  selectedModuleId: 'module-order-summary',
  visibleScenarioIds: ['scenario-checkout-success', 'scenario-coupon-reprice'],
  baseRevisionHashes: {
    'module-order-summary': 'sha256:3c8a…21e4',
    'scenario-checkout-success': 'scn-r22',
  },
};

describe('preview authoring scope policy', () => {
  it('allows current module and current URL scenario candidates without scope expansion', () => {
    expect(requiresScopeDecision('current_module_asset')).toBe(false);
    expect(requiresScopeDecision('same_url_scenario_graph')).toBe(false);
    expect(createPreviewAmendment(scope, 'same_url_scenario_graph', '重排场景').status).toBe(
      'candidate_ready'
    );
  });

  it('requires a decision for another module asset on the same URL', () => {
    const amendment = createPreviewAmendment(
      scope,
      'same_url_foreign_module_asset',
      '修改支付模块'
    );
    expect(requiresScopeDecision(amendment.target)).toBe(true);
    expect(amendment.status).toBe('waiting_decision');
    expect(amendment.decision?.kind).toBe('same_url_foreign_module');
    expect(amendment.decision?.affectedUrls).toHaveLength(1);
  });

  it('requires explicit approval when a proposal reaches another URL', () => {
    const amendment = createPreviewAmendment(scope, 'cross_url_asset', '补充登录恢复');
    expect(amendment.status).toBe('waiting_decision');
    expect(amendment.decision?.kind).toBe('cross_url');
    expect(amendment.decision?.affectedUrls).toHaveLength(2);
    expect(amendment.decision?.baseRevisions).toContain('module-session@req-r7');
    expect(amendment.decision?.targetRevision).toBe('repair-candidate@r10');
  });

  it('rejects stale revisions and a current-module proposal in the wrong module', () => {
    const amendment = createPreviewAmendment(scope, 'current_module_asset', '补强断言');
    expect(isAmendmentApplicable(amendment, scope)).toBe(true);
    expect(
      isAmendmentApplicable(amendment, {
        ...scope,
        selectedModuleId: 'module-payment',
      })
    ).toBe(false);
    expect(
      isAmendmentApplicable(amendment, {
        ...scope,
        baseRevisionHashes: {
          ...scope.baseRevisionHashes,
          'module-order-summary': 'sha256:new-revision',
        },
      })
    ).toBe(false);
  });
});
