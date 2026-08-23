import type {
  PreviewAuthoringAmendment,
  PreviewChangeTarget,
  PreviewContextScope,
  PreviewPage,
  PreviewPrdFragment,
  PreviewRunFixture,
  PreviewScenario,
} from './types.js';

export const previewPrdFragments: PreviewPrdFragment[] = [
  {
    id: 'prd-checkout-summary',
    heading: '3.2 订单确认与金额一致性',
    source: '结算中心 PRD v3.4 · 第 12 页',
    content:
      '用户进入结算页后，应清楚看到商品、优惠、运费与应付金额。任一价格要素发生变化时，总金额必须即时重新计算。',
  },
  {
    id: 'prd-checkout-address',
    heading: '3.3 配送地址',
    source: '结算中心 PRD v3.4 · 第 14 页',
    content:
      '默认选中最近使用的有效地址；地址不完整、超出配送范围或保存失败时，提交订单必须被阻止并显示可行动的提示。',
  },
  {
    id: 'prd-checkout-payment',
    heading: '3.5 支付确认',
    source: '结算中心 PRD v3.4 · 第 18 页',
    content:
      '支付方式切换不得丢失订单上下文。提交后应避免重复扣款；结果未知时进入恢复流程，不得直接重试。',
  },
  {
    id: 'prd-account-session',
    heading: '2.4 身份与会话',
    source: '账号体系 PRD v2.1 · 第 9 页',
    content: '受保护操作发现会话失效时，应要求重新认证，并在身份确认后恢复经过副作用检查的原流程。',
  },
];

export const previewPages: PreviewPage[] = [
  {
    id: 'page-checkout',
    name: '订单结算页',
    routeTemplate: '/checkout/:cartId',
    liveUrl: 'https://staging.shop.example/checkout/cart_8A21',
    modules: [
      {
        id: 'module-order-summary',
        pageDefinitionId: 'page-checkout',
        name: '订单摘要',
        purpose: '核对商品、优惠、运费与应付金额，保证展示与订单数据一致。',
        coverage: 92,
        revision: 'req-r18',
        requirementHash: 'sha256:3c8a…21e4',
        prdFragmentIds: ['prd-checkout-summary'],
        acceptanceCriteria: [
          '商品数量变化后 500ms 内更新总额',
          '优惠与运费分项可追溯',
          '金额异常时禁止提交',
        ],
        functionalPoints: ['读取订单明细', '调整商品数量', '核对价格汇总'],
        scripts: [
          { id: 'script-read-summary', name: '读取订单摘要', status: 'verified', assertions: 4 },
          { id: 'script-change-quantity', name: '调整商品数量', status: 'verified', assertions: 3 },
          { id: 'script-verify-total', name: '核对应付金额', status: 'verified', assertions: 5 },
        ],
      },
      {
        id: 'module-address',
        pageDefinitionId: 'page-checkout',
        name: '配送地址',
        purpose: '选择、补全和验证配送地址，并阻止不可配送订单提交。',
        coverage: 84,
        revision: 'req-r11',
        requirementHash: 'sha256:6a13…6f90',
        prdFragmentIds: ['prd-checkout-address'],
        acceptanceCriteria: [
          '默认地址可见且被选中',
          '不完整地址获得字段级提示',
          '不可配送地址阻止提交',
        ],
        functionalPoints: ['选择已有地址', '新增配送地址', '验证配送范围'],
        scripts: [
          { id: 'script-select-address', name: '选择配送地址', status: 'verified', assertions: 3 },
          { id: 'script-create-address', name: '新增配送地址', status: 'stale', assertions: 4 },
        ],
      },
      {
        id: 'module-payment',
        pageDefinitionId: 'page-checkout',
        name: '支付确认',
        purpose: '选择支付方式并安全提交订单，处理重复提交与结果未知。',
        coverage: 76,
        revision: 'req-r9',
        requirementHash: 'sha256:dd76…91bd',
        prdFragmentIds: ['prd-checkout-payment'],
        acceptanceCriteria: [
          '支付切换保留订单上下文',
          '提交期间按钮不可重复触发',
          '结果未知进入人工决策',
        ],
        functionalPoints: ['选择支付方式', '提交订单', '恢复结果未知支付'],
        scripts: [
          { id: 'script-select-payment', name: '选择支付方式', status: 'verified', assertions: 3 },
          { id: 'script-submit-order', name: '提交订单', status: 'stale', assertions: 6 },
        ],
      },
    ],
  },
  {
    id: 'page-account',
    name: '账号登录页',
    routeTemplate: '/account/login',
    liveUrl: 'https://staging.shop.example/account/login',
    modules: [
      {
        id: 'module-session',
        pageDefinitionId: 'page-account',
        name: '会话恢复',
        purpose: '重新认证并恢复经过副作用检查的业务流程。',
        coverage: 88,
        revision: 'req-r7',
        requirementHash: 'sha256:9be2…0c11',
        prdFragmentIds: ['prd-account-session'],
        acceptanceCriteria: ['凭据不进入普通事件', '恢复前检查原页面状态', '身份不一致时停止执行'],
        functionalPoints: ['识别会话失效', '完成重新登录', '恢复原流程'],
        scripts: [
          { id: 'script-login', name: '账号登录', status: 'verified', assertions: 4 },
          { id: 'script-resume-session', name: '恢复业务会话', status: 'verified', assertions: 3 },
        ],
      },
    ],
  },
];

export const previewScenarios: PreviewScenario[] = [
  {
    id: 'scenario-checkout-success',
    name: '会员标准结算',
    summary: '核对订单、选择地址和支付方式后提交订单。',
    revision: 'scn-r22',
    pageDefinitionIds: ['page-checkout'],
    nodes: [
      {
        id: 'todo-summary',
        label: '核对应付金额',
        moduleId: 'module-order-summary',
        pageDefinitionId: 'page-checkout',
        status: 'passed',
      },
      {
        id: 'todo-address',
        label: '选择配送地址',
        moduleId: 'module-address',
        pageDefinitionId: 'page-checkout',
        status: 'passed',
      },
      {
        id: 'todo-payment',
        label: '提交订单',
        moduleId: 'module-payment',
        pageDefinitionId: 'page-checkout',
        status: 'running',
      },
    ],
    inputs: ['cartId', 'memberId', 'addressId'],
    outputs: ['orderId', 'paymentAttemptId'],
  },
  {
    id: 'scenario-coupon-reprice',
    name: '优惠失效后重新计价',
    summary: '优惠失效时移除优惠并重新核对应付金额。',
    revision: 'scn-r14',
    pageDefinitionIds: ['page-checkout'],
    nodes: [
      {
        id: 'todo-coupon',
        label: '应用失效优惠',
        moduleId: 'module-order-summary',
        pageDefinitionId: 'page-checkout',
        status: 'failed',
      },
      {
        id: 'todo-reprice',
        label: '重新核对金额',
        moduleId: 'module-order-summary',
        pageDefinitionId: 'page-checkout',
        status: 'skipped',
      },
    ],
    inputs: ['cartId', 'couponCode'],
    outputs: ['pricingReason'],
  },
  {
    id: 'scenario-session-recovery',
    name: '会话失效后恢复结算',
    summary: '结算时会话失效，重新认证后恢复原订单。',
    revision: 'scn-r8',
    pageDefinitionIds: ['page-checkout', 'page-account'],
    nodes: [
      {
        id: 'todo-detect-session',
        label: '识别会话失效',
        moduleId: 'module-payment',
        pageDefinitionId: 'page-checkout',
        status: 'passed',
      },
      {
        id: 'todo-login',
        label: '重新登录',
        moduleId: 'module-session',
        pageDefinitionId: 'page-account',
        status: 'pending',
      },
      {
        id: 'todo-resume',
        label: '恢复结算',
        moduleId: 'module-payment',
        pageDefinitionId: 'page-checkout',
        status: 'pending',
      },
    ],
    inputs: ['cartId', 'actorRef'],
    outputs: ['sessionCheckpoint', 'orderId'],
  },
];

export const previewRuns: PreviewRunFixture[] = [
  {
    id: 'run-live',
    name: '结算主链路回归',
    state: 'running',
    statusLabel: '运行中',
    description: '页面子代理正在执行支付提交前检查。',
    activeScenarioId: 'scenario-checkout-success',
    browserUrl: previewPages[0].liveUrl,
    elapsed: '04:18',
    progress: 62,
    todos: [
      { id: 'r1-1', label: '核对应付金额', status: 'passed', detail: '5 项硬断言通过' },
      { id: 'r1-2', label: '选择配送地址', status: 'passed', detail: '地址 addr_402 已确认' },
      { id: 'r1-3', label: '提交订单', status: 'running', detail: '原子操作 op_8F21 进行中' },
      { id: 'r1-4', label: '验证订单结果', status: 'pending', detail: '等待上游输出 orderId' },
    ],
  },
  {
    id: 'run-decision',
    name: '支付风控验证',
    state: 'waiting_decision',
    statusLabel: '等待审批',
    description: '检测到 staging 删除测试支付方式，需要计划级批准。',
    activeScenarioId: 'scenario-checkout-success',
    browserUrl: previewPages[0].liveUrl,
    elapsed: '02:46',
    progress: 48,
    todos: [
      { id: 'r2-1', label: '读取支付方式', status: 'passed', detail: '发现 3 个候选方式' },
      { id: 'r2-2', label: '清理旧测试方式', status: 'blocked', detail: '等待副作用决策 dec_302' },
      { id: 'r2-3', label: '提交订单', status: 'pending', detail: '依赖决策结果' },
    ],
  },
  {
    id: 'run-interrupted',
    name: '订单恢复验证',
    state: 'interrupted',
    statusLabel: '结果未知',
    description: '提交后连接中断，必须先检查副作用，禁止盲目重放。',
    activeScenarioId: 'scenario-session-recovery',
    browserUrl: previewPages[0].liveUrl,
    elapsed: '06:03',
    progress: 71,
    todos: [
      { id: 'r3-1', label: '提交订单', status: 'blocked', detail: 'operation outcome unknown' },
      { id: 'r3-2', label: '检查订单副作用', status: 'pending', detail: '等待恢复检查点' },
      { id: 'r3-3', label: '恢复或收敛', status: 'pending', detail: '不得使用新 operationId 重试' },
    ],
  },
  {
    id: 'run-failed',
    name: '优惠依赖回归',
    state: 'failed',
    statusLabel: '失败',
    description: '优惠组件契约变化，下游重新计价因依赖失败被跳过。',
    activeScenarioId: 'scenario-coupon-reprice',
    browserUrl: previewPages[0].liveUrl,
    elapsed: '01:57',
    progress: 38,
    todos: [
      { id: 'r4-1', label: '应用失效优惠', status: 'failed', detail: '错误提示契约不匹配' },
      { id: 'r4-2', label: '重新核对金额', status: 'skipped', detail: '依赖 todo r4-1 失败' },
      { id: 'r4-3', label: '提交订单', status: 'skipped', detail: '阻断性依赖未满足' },
    ],
  },
  {
    id: 'run-completed',
    name: '访客标准结算',
    state: 'completed',
    statusLabel: '已完成',
    description: '4 个 TODO、18 项断言全部通过，证据清单已封存。',
    activeScenarioId: 'scenario-checkout-success',
    browserUrl: previewPages[0].liveUrl,
    elapsed: '03:42',
    progress: 100,
    todos: [
      { id: 'r5-1', label: '核对应付金额', status: 'passed', detail: '证据 ev_901' },
      { id: 'r5-2', label: '选择配送地址', status: 'passed', detail: '证据 ev_902' },
      { id: 'r5-3', label: '提交订单', status: 'passed', detail: '证据 ev_903' },
      { id: 'r5-4', label: '验证订单结果', status: 'passed', detail: '证据清单 mf_184 已封存' },
    ],
  },
];

const targetCopy: Record<PreviewChangeTarget, { summary: string; affected: string[] }> = {
  current_module_asset: {
    summary: '补强当前模块的交互步骤与硬断言，并重新验证受影响脚本。',
    affected: ['module-order-summary', 'script-verify-total'],
  },
  same_url_scenario_graph: {
    summary: '重排当前 URL 内的场景调用顺序，不修改其他模块资产。',
    affected: ['scenario-checkout-success', 'scenario-coupon-reprice'],
  },
  same_url_foreign_module_asset: {
    summary: '建议同步修改同页支付模块的提交前校验，需要扩展模块写入范围。',
    affected: ['module-payment', 'script-submit-order'],
  },
  cross_url_asset: {
    summary: '建议修改登录页的会话恢复调用，需要人工批准跨 URL 影响范围。',
    affected: ['page-account', 'module-session', 'scenario-session-recovery'],
  },
};

export function createPreviewAmendment(
  scope: PreviewContextScope,
  target: PreviewChangeTarget,
  reason: string
): PreviewAuthoringAmendment {
  const copy = targetCopy[target];
  const needsDecision = target === 'same_url_foreign_module_asset' || target === 'cross_url_asset';
  const decisionKind = target === 'cross_url_asset' ? 'cross_url' : 'same_url_foreign_module';

  return {
    id: `amendment-${Date.now()}`,
    jobId: `repair-${String(Date.now()).slice(-6)}`,
    createdAt: new Date().toISOString(),
    status: needsDecision ? 'waiting_decision' : 'candidate_ready',
    target,
    reason,
    changeKind: target === 'same_url_scenario_graph' ? 'contract' : 'interaction',
    scope,
    affectedAssetIds: copy.affected,
    summary: copy.summary,
    diff: [
      { kind: 'keep', text: '保留：确认订单金额与页面展示一致' },
      { kind: 'remove', text: '移除：依赖固定等待时间确认重算完成' },
      { kind: 'add', text: '新增：等待金额组件达到可交互且价格版本发生变化' },
      { kind: 'add', text: '新增：校验优惠、运费与应付金额的可追溯关系' },
    ],
    verificationPlan: [
      '执行静态 Schema 与引用校验',
      '在当前部署真实浏览器中验证候选',
      '通过后原子激活修订',
    ],
    decision: needsDecision
      ? {
          id: `decision-${String(Date.now()).slice(-5)}`,
          kind: decisionKind,
          status: 'pending',
          reason: copy.summary,
          affectedUrls:
            target === 'cross_url_asset' ? [scope.url, previewPages[1].liveUrl] : [scope.url],
          affectedModules:
            target === 'cross_url_asset' ? ['支付确认', '会话恢复'] : ['订单摘要', '支付确认'],
          affectedScenarios:
            target === 'cross_url_asset' ? ['会话失效后恢复结算'] : ['会员标准结算'],
          baseRevisions:
            target === 'cross_url_asset'
              ? [
                  'module-payment@req-r9',
                  'module-session@req-r7',
                  'scenario-session-recovery@scn-r8',
                ]
              : ['module-order-summary@req-r18', 'module-payment@req-r9'],
          targetRevision:
            target === 'cross_url_asset' ? 'repair-candidate@r10' : 'repair-candidate@r19',
          sideEffects: ['生成新的候选修订，不覆盖现有 current', '审批后仍需真实浏览器验证'],
        }
      : undefined,
  };
}
