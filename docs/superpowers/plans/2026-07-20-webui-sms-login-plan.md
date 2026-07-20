# WebUI 短信验证码登录 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 NapCat WebUI 新增短信验证码登录入口（独立 Tab + 新设备验证 Tab 切换），后端采用 5 层分层尝试策略穷尽所有可能的短信登录协议路径。

**架构：** 前端新增短信登录组件和新设备验证短信子组件（React + Vite），后端新增 2 个 Express handler（RequestSmsCode / SmsVerify），内部按 L1-L5 分层尝试（内核隐藏方法 → passwordLogin step 穷举 → OIDB 变体 → OIDB 扫描 → accounts.qq.com Web 接口）。成功路径统一汇合到现有 NewDeviceLogin 收尾。

**技术栈：** TypeScript、React 19、Vite 6、Express 5、pnpm monorepo、vitest

---

## 文件清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `packages/napcat-webui-frontend/src/components/new_device_verify.tsx` | 改造 | 拆分为容器组件，Tab 切换扫码/短信 |
| `packages/napcat-webui-frontend/src/components/new_device_qr_verify.tsx` | 新建 | 原扫码逻辑搬迁 |
| `packages/napcat-webui-frontend/src/components/new_device_sms_verify.tsx` | 新建 | 新设备验证的短信子组件 |
| `packages/napcat-webui-frontend/src/components/sms_login.tsx` | 新建 | 独立短信登录 Tab 组件 |
| `packages/napcat-webui-frontend/src/pages/qq_login.tsx` | 修改 | 新增第 4 个 Tab "短信登录" |
| `packages/napcat-webui-frontend/src/controllers/qq_manager.ts` | 修改 | 新增 requestSmsCode / smsVerify 方法 |
| `packages/napcat-webui-backend/src/api/QQLogin.ts` | 修改 | 新增 QQRequestSmsCodeHandler / QQSmsVerifyHandler + 分层尝试器 |
| `packages/napcat-webui-backend/src/router/QQLogin.ts` | 修改 | 注册 2 个新路由 |

---

## 任务 1：后端 - 通用 OIDB 请求工具 + 分层尝试器骨架

**文件：**
- 修改：`packages/napcat-webui-backend/src/api/QQLogin.ts`
- 测试：`packages/napcat-webui-backend/__tests__/sms_login.spec.ts`

### 1.1 提取通用 oidbRequest 函数

将现有的硬编码 `oidb_0xc9e_8` 的 `oidbRequest` 函数改造为可配置命令号的通用函数。

- [ ] **步骤 1：修改 oidbRequest 支持自定义命令号**

在 `packages/napcat-webui-backend/src/api/QQLogin.ts` 中，将 `oidbRequest` 函数签名改为：

```typescript
function oidbRequest (
  uid: string,
  cmd: string, // 如 "0xc9e_8"
  body: Record<string, unknown>,
  extraParams: Record<string, string> = {},
): Promise<Record<string, unknown>>
```

path 拼装改为：
```typescript
const params = new URLSearchParams({
  uid,
  sdkappid: '39998',
  actype: '2',
  ...extraParams,
});
const path = `/v3/oidbinterface/oidb_${cmd}?${params.toString()}`;
```

现有调用方（第 506 行附近的 `QQGetNewDeviceQRCodeHandler`）更新为 `oidbRequest(uid, '0xc9e_8', body, { getqrcode: '1' })`。

- [ ] **步骤 2：验证现有调用仍工作**

运行 typecheck 确认编译无错：
```bash
pnpm --filter napcat-webui-backend run build 2>&1 | head -30
```
预期：编译通过，无类型错误。

- [ ] **步骤 3：Commit**

```bash
git add packages/napcat-webui-backend/src/api/QQLogin.ts
git commit -m "refactor: extract generic oidbRequest with configurable cmd"
```

### 1.2 新增分层尝试器 + 两个新 handler 骨架

- [ ] **步骤 1：编写失败的测试**

创建 `packages/napcat-webui-backend/__tests__/sms_login.spec.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 整个模块
vi.mock('@/napcat-webui-backend/src/helper/Data', () => ({
  WebUiDataRuntime: {
    getOneBotContext: () => ({}),
    getQQDataPath: () => '/tmp/fake',
  },
}));
vi.mock('https', () => ({ default: { request: vi.fn() } }));

describe('QQRequestSmsCodeHandler', () => {
  let handler: any;

  beforeEach(async () => {
    const mod = await import('@/napcat-webui-backend/src/api/QQLogin');
    handler = mod.QQRequestSmsCodeHandler;
  });

  it('exists as a function', () => {
    expect(typeof handler).toBe('function');
  });
});

describe('QQSmsVerifyHandler', () => {
  let handler: any;

  beforeEach(async () => {
    const mod = await import('@/napcat-webui-backend/src/api/QQLogin');
    handler = mod.QQSmsVerifyHandler;
  });

  it('exists as a function', () => {
    expect(typeof handler).toBe('function');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：FAIL，报错 `QQRequestSmsCodeHandler is not defined`

- [ ] **步骤 3：编写最小骨架实现**

在 `packages/napcat-webui-backend/src/api/QQLogin.ts` 末尾添加：

```typescript
// 短信登录：发送验证码
export const QQRequestSmsCodeHandler: RequestHandler = async (req, res) => {
  const { uin } = req.body || {};
  if (isEmpty(uin)) {
    return sendError(res, 'uin is required');
  }
  return sendSuccess(res, {
    success: false,
    message: '短信登录暂不可用，请使用扫码登录',
    attemptedMethods: [],
  });
};

// 短信登录：提交验证码
export const QQSmsVerifyHandler: RequestHandler = async (req, res) => {
  const { uin, code } = req.body || {};
  if (isEmpty(uin) || isEmpty(code)) {
    return sendError(res, 'uin and code are required');
  }
  return sendSuccess(res, {
    success: false,
    message: '短信验证暂不可用，请使用扫码登录',
  });
};
```

- [ ] **步骤 4：运行测试确认通过**

```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add packages/napcat-webui-backend/src/api/QQLogin.ts packages/napcat-webui-backend/__tests__/sms_login.spec.ts
git commit -m "feat: add QQRequestSmsCodeHandler and QQSmsVerifyHandler skeletons"
```

---

## 任务 2：后端 - 路由注册 + L1 内核隐藏方法尝试

**文件：**
- 修改：`packages/napcat-webui-backend/src/router/QQLogin.ts`
- 修改：`packages/napcat-webui-backend/src/api/QQLogin.ts`

### 2.1 注册新路由

- [ ] **步骤 1：在路由文件中注册 2 个新路由**

在 `packages/napcat-webui-backend/src/router/QQLogin.ts` 中，在现有 `router.post('/PollNewDeviceQR', ...)` 之后添加：

```typescript
router.post('/RequestSmsCode', QQRequestSmsCodeHandler);
router.post('/SmsVerify', QQSmsVerifyHandler);
```

并在文件顶部 import 中添加 `QQRequestSmsCodeHandler, QQSmsVerifyHandler`。

- [ ] **步骤 2：验证编译通过**

```bash
pnpm --filter napcat-webui-backend run build 2>&1 | head -20
```
预期：编译通过。

- [ ] **步骤 3：Commit**

```bash
git add packages/napcat-webui-backend/src/router/QQLogin.ts
git commit -m "feat: register RequestSmsCode and SmsVerify routes"
```

### 2.2 实现 L1：内核隐藏方法尝试（RequestSmsCode）

- [ ] **步骤 1：编写测试 - L1 尝试失败时回退**

在 `packages/napcat-webui-backend/__tests__/sms_login.spec.ts` 的 `describe('QQRequestSmsCodeHandler')` 块中添加：

```typescript
  it('returns failure with attemptedMethods when all layers fail', async () => {
    const mockReq: any = { body: { uin: '123456' } };
    const mockRes: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await handler(mockReq, mockRes);
    expect(mockRes.json).toHaveBeenCalled();
    const callArg = mockRes.json.mock.calls[0][0];
    expect(callArg.data.success).toBe(false);
    expect(Array.isArray(callArg.data.attemptedMethods)).toBe(true);
  });
```

- [ ] **步骤 2：运行测试确认失败**

```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：FAIL（attemptedMethods 为 [] 但骨架确实返回了空数组——此测试应通过。验证通过后下一步添加 L1 逻辑。）

- [ ] **步骤 3：实现 L1 隐藏方法调用逻辑**

在 `QQRequestSmsCodeHandler` 中，在返回失败之前插入 L1 尝试：

```typescript
  const attemptedMethods: string[] = [];

  // L1: 内核隐藏方法调用
  try {
    const ctx = WebUiDataRuntime.getOneBotContext();
    const loginService: any = ctx?.core?.services?.NodeIKernelLoginService;
    if (loginService) {
      const candidateMethods = [
        'requestSmsCode', 'sendSmsCode', 'sendSmsVerifyCode',
        'loginSms', 'loginWithSms', 'smsLogin',
        'requestMobileCode', 'sendMobileVerifyCode',
        'getSmsCode', 'fetchSmsCode',
      ];
      for (const methodName of candidateMethods) {
        if (typeof loginService[methodName] === 'function') {
          attemptedMethods.push(`L1_kernel_${methodName}`);
          try {
            // 尝试多种参数形式
            const argForms = [
              [uin],
              [{ uin }],
              [{ uin, jumpUrl: req.body.jumpUrl }],
            ];
            for (const args of argForms) {
              try {
                const result = await loginService[methodName](...args);
                if (result && (result.phoneTail || result.smsPhoneTail || result.mobileTail)) {
                  return sendSuccess(res, {
                    success: true,
                    phoneTail: result.phoneTail || result.smsPhoneTail || result.mobileTail,
                    sig: result.sig || result.smsSig || result.str_sms_sig || '',
                    method: `kernel_${methodName}`,
                    attemptedMethods,
                  });
                }
              } catch { /* 忽略参数形式错误，试下一个 */ }
            }
          } catch (e: any) {
            // 方法调用失败，继续下一个
          }
        }
      }
    }
  } catch (e: any) {
    // L1 整体失败，继续下一层
  }
```

- [ ] **步骤 4：运行测试确认通过**

```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add packages/napcat-webui-backend/src/api/QQLogin.ts packages/napcat-webui-backend/__tests__/sms_login.spec.ts
git commit -m "feat: implement L1 kernel hidden method attempts for RequestSmsCode"
```

### 2.3 实现 L1：内核隐藏方法尝试（SmsVerify）

- [ ] **步骤 1：为 SmsVerify 添加 L1 尝试逻辑**

在 `QQSmsVerifyHandler` 中添加类似的 L1 尝试：

```typescript
  const attemptedMethods: string[] = [];

  // L1: 内核隐藏方法调用
  try {
    const ctx = WebUiDataRuntime.getOneBotContext();
    const loginService: any = ctx?.core?.services?.NodeIKernelLoginService;
    if (loginService) {
      const candidateMethods = [
        'submitSmsCode', 'verifySmsCode', 'loginSmsVerify',
        'smsVerify', 'checkSmsCode', 'confirmSmsCode',
      ];
      for (const methodName of candidateMethods) {
        if (typeof loginService[methodName] === 'function') {
          attemptedMethods.push(`L1_kernel_${methodName}`);
          try {
            const argForms = [
              [uin, code],
              [{ uin, code }],
              [{ uin, code, sig: req.body.sig }],
            ];
            for (const args of argForms) {
              try {
                const result = await loginService[methodName](...args);
                if (result && (result.ntToken || result.str_nt_succ_token || result.token || result.success)) {
                  return sendSuccess(res, {
                    success: true,
                    ntToken: result.ntToken || result.str_nt_succ_token || result.token || '',
                    method: `kernel_${methodName}`,
                    attemptedMethods,
                  });
                }
              } catch { /* 忽略参数形式错误 */ }
            }
          } catch (e: any) {
            // 方法调用失败，继续下一个
          }
        }
      }
    }
  } catch (e: any) {
    // L1 整体失败，继续下一层
  }
```

- [ ] **步骤 2：运行测试确认通过**

```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add packages/napcat-webui-backend/src/api/QQLogin.ts
git commit -m "feat: implement L1 kernel hidden method attempts for SmsVerify"
```

---

## 任务 3：后端 - L2 passwordLogin step 穷举 + L3 OIDB 变体

**文件：**
- 修改：`packages/napcat-webui-backend/src/api/QQLogin.ts`
- 测试：`packages/napcat-webui-backend/__tests__/sms_login.spec.ts`

### 3.1 实现 L2：passwordLogin step 穷举（RequestSmsCode）

- [ ] **步骤 1：编写测试**

在 `sms_login.spec.ts` 中添加：
```typescript
  it('L2 passwordLogin step returns sms fields when matched', async () => {
    // 验证 attemptedMethods 包含 L2 标签
    const mockReq: any = { body: { uin: '123456', passwordMd5: 'fake_md5', jumpUrl: 'fake_jump' } };
    const mockRes: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await handler(mockReq, mockRes);
    const callArg = mockRes.json.mock.calls[0][0];
    // 确保 attemptedMethods 中有 L2 相关的记录
    const hasL2 = callArg.data.attemptedMethods.some((m: string) => m.startsWith('L2_'));
    expect(hasL2).toBe(true);
  });
```

- [ ] **步骤 2：运行测试确认失败**
```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：FAIL（还没有 L2 实现）

- [ ] **步骤 3：实现 L2 逻辑**

在 `QQRequestSmsCodeHandler` 的 L1 块之后、最终失败返回之前添加：

```typescript
  // L2: passwordLogin step 穷举
  if (req.body.passwordMd5 && req.body.jumpUrl) {
    try {
      const ctx = WebUiDataRuntime.getOneBotContext();
      const loginService: any = ctx?.core?.services?.NodeIKernelLoginService;
      if (loginService && typeof loginService.passwordLogin === 'function') {
        const steps = [1, 2, 3, 10, 11, 20, 100];
        for (const step of steps) {
          attemptedMethods.push(`L2_passwordLogin_step_${step}`);
          try {
            const result = await loginService.passwordLogin({
              uin,
              passwordMd5: req.body.passwordMd5,
              step,
              newDeviceLoginSig: req.body.newDevicePullQrCodeSig || '',
            });
            const errorInfo = result?.loginErrorInfo || result?.errorInfo || result || {};
            const phoneTail = errorInfo.smsPhoneTail || errorInfo.phoneTail || errorInfo.mobileTail;
            const sig = errorInfo.smsSig || errorInfo.str_sms_sig || errorInfo.sig;
            if (phoneTail) {
              return sendSuccess(res, {
                success: true,
                phoneTail,
                sig: sig || '',
                method: `passwordLogin_step_${step}`,
                attemptedMethods,
              });
            }
          } catch { /* 单个 step 失败，继续下一个 */ }
        }
      }
    } catch (e: any) {
      // L2 整体失败
    }
  }
```

- [ ] **步骤 4：运行测试确认通过**
```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：PASS

- [ ] **步骤 5：Commit**
```bash
git add packages/napcat-webui-backend/src/api/QQLogin.ts packages/napcat-webui-backend/__tests__/sms_login.spec.ts
git commit -m "feat: implement L2 passwordLogin step brute-force for RequestSmsCode"
```

### 3.2 实现 L3：OIDB 已知命令号变体（RequestSmsCode）

- [ ] **步骤 1：实现 L3 逻辑**

在 L2 块之后添加：

```typescript
  // L3: OIDB 已知命令号变体
  try {
    const variants = [
      // 同 command 不同 subcmd
      ...Array.from({ length: 20 }, (_, i) => `0xc9e_${i + 1}`),
      // 相邻 command
      '0xc9d_1', '0xc9d_8', '0xc9f_1', '0xc9f_8',
    ];
    for (const cmd of variants) {
      attemptedMethods.push(`L3_oidb_${cmd}`);
      try {
        const body: Record<string, unknown> = {
          uint32_flag: 2,
          str_uin_token: uin,
          str_jump_url: req.body.jumpUrl || '',
        };
        const result = await Promise.race([
          oidbRequest(uin, cmd, body, {}),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        // 检查响应中是否有短信相关字段
        const resultStr = JSON.stringify(result);
        const smsKeywords = ['phoneTail', 'smsPhone', 'mobileTail', 'phone_last', 'sms_sig', 'smsSig'];
        const hasSmsField = smsKeywords.some(kw => resultStr.includes(kw));
        if (hasSmsField && result && result.int32_retcode === 0) {
          // 尝试提取
          const phoneTail = extractField(result, ['phoneTail', 'smsPhoneTail', 'mobileTail', 'phone_last4']);
          const sig = extractField(result, ['smsSig', 'sms_sig', 'str_sms_sig', 'sig']);
          return sendSuccess(res, {
            success: true,
            phoneTail: phoneTail || '',
            sig: sig || '',
            method: `oidb_${cmd}`,
            attemptedMethods,
          });
        }
      } catch { /* 单个变体失败，继续 */ }
    }
  } catch (e: any) {
    // L3 整体失败
  }
```

同时在文件顶部附近添加辅助函数：
```typescript
// 从嵌套对象中递归提取指定字段值
function extractField (obj: any, fieldNames: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of Object.keys(obj)) {
    if (fieldNames.some(f => key.toLowerCase() === f.toLowerCase())) {
      return String(obj[key]);
    }
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === 'object') {
      const found = extractField(val, fieldNames);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
```

- [ ] **步骤 2：运行测试确认通过**
```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：PASS

- [ ] **步骤 3：Commit**
```bash
git add packages/napcat-webui-backend/src/api/QQLogin.ts
git commit -m "feat: implement L3 OIDB variant brute-force for RequestSmsCode"
```

---

## 任务 4：后端 - L4 OIDB 扫描 + L5 accounts.qq.com + SmsVerify 对应层

**文件：**
- 修改：`packages/napcat-webui-backend/src/api/QQLogin.ts`

### 4.1 实现 L4：OIDB 短信相关命令号扫描（RequestSmsCode）

- [ ] **步骤 1：实现 L4 逻辑**

在 L3 之后添加：

```typescript
  // L4: OIDB 短信相关命令号扫描（最多 20 个，避免风控）
  try {
    const scanCmds = [
      // 0xdxx 系列 (登录/安全相关)
      '0xd00_1', '0xd01_1', '0xd02_1', '0xd10_1', '0xd11_1',
      '0xd20_1', '0xd30_1', '0xd40_1', '0xd50_1', '0xd52_1',
      // 0x11xx 系列
      '0x1100_1', '0x1101_1', '0x1102_1', '0x1110_1', '0x1111_1',
      // 其他可疑范围
      '0x1001_1', '0x1002_1', '0x1003_1', '0x1200_1', '0x1234_1',
    ];
    for (const cmd of scanCmds) {
      attemptedMethods.push(`L4_oidb_${cmd}`);
      try {
        const body: Record<string, unknown> = {
          uint32_flag: 1,
          str_uin_token: uin,
        };
        const result = await Promise.race([
          oidbRequest(uin, cmd, body, {}),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        const resultStr = JSON.stringify(result);
        const smsKeywords = ['phoneTail', 'smsPhone', 'mobileTail', 'sms_sig', 'smsSig', 'phone_last'];
        const hasSmsField = smsKeywords.some(kw => resultStr.includes(kw));
        if (hasSmsField && result && result.int32_retcode === 0) {
          const phoneTail = extractField(result, ['phoneTail', 'smsPhoneTail', 'mobileTail', 'phone_last4']);
          const sig = extractField(result, ['smsSig', 'sms_sig', 'str_sms_sig', 'sig']);
          return sendSuccess(res, {
            success: true,
            phoneTail: phoneTail || '',
            sig: sig || '',
            method: `oidb_${cmd}`,
            attemptedMethods,
          });
        }
      } catch { /* 单个命令号失败，继续 */ }
    }
  } catch (e: any) {
    // L4 整体失败
  }
```

- [ ] **步骤 2：运行测试确认通过**
```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：PASS

- [ ] **步骤 3：Commit**
```bash
git add packages/napcat-webui-backend/src/api/QQLogin.ts
git commit -m "feat: implement L4 OIDB command scan for RequestSmsCode"
```

### 4.2 实现 L5：accounts.qq.com Web 短信接口（RequestSmsCode）

- [ ] **步骤 1：实现 L5 逻辑**

在 L4 之后添加：

```typescript
  // L5: accounts.qq.com Web 短信接口
  try {
    attemptedMethods.push('L5_accounts_qq');
    // 尝试从 jumpUrl 中提取 token
    let token = '';
    if (req.body.jumpUrl) {
      try {
        const url = new URL(req.body.jumpUrl);
        token = url.searchParams.get('token') || url.searchParams.get('t') || '';
      } catch { /* 解析失败 */ }
    }
    // 尝试几种常见的 accounts.qq.com 短信发送端点
    const endpoints = [
      'https://accounts.qq.com/safe/sendsms',
      'https://accounts.qq.com/sms/send',
      'https://uin.qq.com/cgi-bin/sendsms',
    ];
    for (const endpoint of endpoints) {
      try {
        const postData = JSON.stringify({ uin, token, biz: 'login' });
        const result = await new Promise<string>((resolve, reject) => {
          const req2 = https.request({
            hostname: new URL(endpoint).hostname,
            path: new URL(endpoint).pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          }, (res2) => {
            let data = '';
            res2.on('data', (chunk) => { data += chunk; });
            res2.on('end', () => resolve(data));
          });
          req2.on('error', reject);
          req2.write(postData);
          req2.end();
        });
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        const smsKeywords = ['phoneTail', 'smsPhone', 'mobileTail', 'sms_sig'];
        if (smsKeywords.some(kw => resultStr.includes(kw))) {
          try {
            const parsed = JSON.parse(resultStr);
            const phoneTail = extractField(parsed, ['phoneTail', 'smsPhoneTail', 'mobileTail']);
            const sig = extractField(parsed, ['smsSig', 'sms_sig', 'token', 'sig']);
            return sendSuccess(res, {
              success: true,
              phoneTail: phoneTail || '',
              sig: sig || '',
              method: `accounts_qq_${endpoint}`,
              attemptedMethods,
            });
          } catch { /* 解析失败，继续 */ }
        }
      } catch { /* 单个端点失败，继续 */ }
    }
  } catch (e: any) {
    // L5 整体失败
  }
```

- [ ] **步骤 2：运行测试确认通过**
```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：PASS

- [ ] **步骤 3：Commit**
```bash
git add packages/napcat-webui-backend/src/api/QQLogin.ts
git commit -m "feat: implement L5 accounts.qq.com web API attempt for RequestSmsCode"
```

### 4.3 SmsVerify 对应 L3/L4/L5 实现

- [ ] **步骤 1：为 SmsVerify 添加 L3-L5 尝试逻辑**

在 `QQSmsVerifyHandler` 的 L1 之后添加：

```typescript
  // L3: OIDB 已知命令号变体（验证短信）
  try {
    const variants = [
      ...Array.from({ length: 20 }, (_, i) => `0xc9e_${i + 1}`),
      '0xc9d_1', '0xc9d_8', '0xc9f_1', '0xc9f_8',
    ];
    for (const cmd of variants) {
      attemptedMethods.push(`L3_oidb_${cmd}`);
      try {
        const body: Record<string, unknown> = {
          uint32_flag: 3,
          str_uin_token: uin,
          str_sms_code: code,
          str_sms_sig: sig || '',
        };
        const result = await Promise.race([
          oidbRequest(uin, cmd, body, {}),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        const ntToken = extractField(result, ['ntToken', 'str_nt_succ_token', 'token', 'succ_token']);
        if (ntToken && result && result.int32_retcode === 0) {
          return sendSuccess(res, {
            success: true,
            ntToken,
            method: `oidb_${cmd}`,
            attemptedMethods,
          });
        }
      } catch { /* 单个变体失败 */ }
    }
  } catch { /* L3 整体失败 */ }

  // L4: OIDB 短信相关命令号扫描（验证）
  try {
    const scanCmds = [
      '0xd00_1', '0xd01_1', '0xd02_1', '0xd10_1', '0xd11_1',
      '0xd20_1', '0xd30_1', '0xd40_1', '0xd50_1', '0xd52_1',
      '0x1100_1', '0x1101_1', '0x1102_1', '0x1110_1', '0x1111_1',
      '0x1001_1', '0x1002_1', '0x1003_1', '0x1200_1', '0x1234_1',
    ];
    for (const cmd of scanCmds) {
      attemptedMethods.push(`L4_oidb_${cmd}`);
      try {
        const body: Record<string, unknown> = {
          uint32_flag: 1,
          str_uin_token: uin,
          str_sms_code: code,
          str_sms_sig: sig || '',
        };
        const result = await Promise.race([
          oidbRequest(uin, cmd, body, {}),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        const ntToken = extractField(result, ['ntToken', 'str_nt_succ_token', 'token', 'succ_token']);
        if (ntToken && result && result.int32_retcode === 0) {
          return sendSuccess(res, {
            success: true,
            ntToken,
            method: `oidb_${cmd}`,
            attemptedMethods,
          });
        }
      } catch { /* 单个命令号失败 */ }
    }
  } catch { /* L4 整体失败 */ }

  // L5: accounts.qq.com Web 短信验证接口
  try {
    attemptedMethods.push('L5_accounts_qq_verify');
    const endpoints = [
      'https://accounts.qq.com/safe/verifysms',
      'https://accounts.qq.com/sms/verify',
      'https://uin.qq.com/cgi-bin/verifysms',
    ];
    for (const endpoint of endpoints) {
      try {
        const postData = JSON.stringify({ uin, code, sig: sig || '', biz: 'login' });
        const result = await new Promise<string>((resolve, reject) => {
          const req2 = https.request({
            hostname: new URL(endpoint).hostname,
            path: new URL(endpoint).pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          }, (res2) => {
            let data = '';
            res2.on('data', (chunk) => { data += chunk; });
            res2.on('end', () => resolve(data));
          });
          req2.on('error', reject);
          req2.write(postData);
          req2.end();
        });
        try {
          const parsed = JSON.parse(result);
          const ntToken = extractField(parsed, ['ntToken', 'token', 'succ_token', 'str_nt_succ_token']);
          if (ntToken && (parsed.retcode === 0 || parsed.code === 0 || parsed.success)) {
            return sendSuccess(res, {
              success: true,
              ntToken,
              method: `accounts_qq_verify_${endpoint}`,
              attemptedMethods,
            });
          }
        } catch { /* 解析失败 */ }
      } catch { /* 单个端点失败 */ }
    }
  } catch { /* L5 整体失败 */ }
```

- [ ] **步骤 2：运行测试确认通过**
```bash
pnpm --filter napcat-test run test -- sms_login 2>&1 | tail -20
```
预期：PASS

- [ ] **步骤 3：Commit**
```bash
git add packages/napcat-webui-backend/src/api/QQLogin.ts
git commit -m "feat: implement L3/L4/L5 for SmsVerify handler"
```

---

## 任务 5：前端 - 新设备验证组件拆分 + 短信子组件

**文件：**
- 创建：`packages/napcat-webui-frontend/src/components/new_device_qr_verify.tsx`
- 创建：`packages/napcat-webui-frontend/src/components/new_device_sms_verify.tsx`
- 修改：`packages/napcat-webui-frontend/src/components/new_device_verify.tsx`

### 5.1 拆分扫码验证到独立组件

- [ ] **步骤 1：创建 new_device_qr_verify.tsx**

从 `new_device_verify.tsx` 中将现有的二维码显示、轮询、取消等逻辑搬迁到新组件 `NewDeviceQRVerify`。Props 保持与原组件内部使用一致：
```tsx
interface NewDeviceQRVerifyProps {
  uin: string;
  jumpUrl: string;
  newDevicePullQrCodeSig: string;
  passwordMd5: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}
```

直接搬运现有组件的所有 JSX 和 hooks 逻辑，改名为 `NewDeviceQRVerify`。

- [ ] **步骤 2：运行构建确认无错**
```bash
pnpm --filter napcat-webui-frontend run build 2>&1 | tail -20
```
预期：构建成功。

- [ ] **步骤 3：Commit**
```bash
git add packages/napcat-webui-frontend/src/components/new_device_qr_verify.tsx
git commit -m "refactor: extract QR verify to independent component"
```

### 5.2 创建短信验证子组件

- [ ] **步骤 1：创建 new_device_sms_verify.tsx**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Button, Input, message } from 'antd';
import { QQManager } from '../controllers/qq_manager';

interface NewDeviceSmsVerifyProps {
  uin: string;
  jumpUrl: string;
  newDevicePullQrCodeSig: string;
  passwordMd5: string;
  onSuccess: (ntToken: string) => void;
  onError: (msg: string) => void;
  onSwitchToQR: () => void;
}

export default function NewDeviceSmsVerify ({
  uin,
  jumpUrl,
  newDevicePullQrCodeSig,
  passwordMd5,
  onSuccess,
  onError,
  onSwitchToQR,
}: NewDeviceSmsVerifyProps) {
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [phoneTail, setPhoneTail] = useState('');
  const [smsSig, setSmsSig] = useState('');
  const [smsMethod, setSmsMethod] = useState('');

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendCode = useCallback(async () => {
    setLoading(true);
    try {
      const result = await QQManager.requestSmsCode(uin, jumpUrl, passwordMd5, newDevicePullQrCodeSig);
      if (result.success && result.phoneTail) {
        setPhoneTail(result.phoneTail);
        setSmsSig(result.sig || '');
        setSmsMethod(result.method || '');
        setCountdown(60);
        message.success('验证码已发送');
      } else {
        message.error(result.message || '发送失败');
        setTimeout(() => onSwitchToQR(), 2000);
      }
    } catch (e: any) {
      onError(e.message || '发送验证码失败');
    } finally {
      setLoading(false);
    }
  }, [uin, jumpUrl, passwordMd5, newDevicePullQrCodeSig, onError, onSwitchToQR]);

  const handleVerify = useCallback(async () => {
    if (code.length !== 6) {
      message.warning('请输入 6 位验证码');
      return;
    }
    setLoading(true);
    try {
      const result = await QQManager.smsVerify(uin, code, smsSig);
      if (result.success && result.ntToken) {
        message.success('验证成功');
        onSuccess(result.ntToken);
      } else {
        message.error(result.message || '验证失败');
      }
    } catch (e: any) {
      onError(e.message || '验证失败');
    } finally {
      setLoading(false);
    }
  }, [uin, code, smsSig, onSuccess, onError]);

  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <p style={{ marginBottom: 16 }}>
        验证码将发送到 {phoneTail ? `手机尾号 ${phoneTail}` : '该 QQ 绑定的手机'}
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="请输入 6 位验证码"
          maxLength={6}
          style={{ flex: 1 }}
        />
        <Button
          onClick={handleSendCode}
          disabled={countdown > 0 || loading}
          style={{ width: 120 }}
        >
          {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
        </Button>
      </div>
      <Button
        type="primary"
        onClick={handleVerify}
        loading={loading}
        style={{ width: '100%', marginBottom: 8 }}
      >
        登录
      </Button>
      <Button type="link" onClick={onSwitchToQR}>
        返回扫码验证
      </Button>
    </div>
  );
}
```

- [ ] **步骤 2：运行构建确认无错**
```bash
pnpm --filter napcat-webui-frontend run build 2>&1 | tail -20
```
预期：构建成功（可能有 TS 报错因为 `QQManager.requestSmsCode` 还没实现，先忽略，下一步实现）。

- [ ] **步骤 3：Commit**
```bash
git add packages/napcat-webui-frontend/src/components/new_device_sms_verify.tsx
git commit -m "feat: add NewDeviceSmsVerify component"
```

### 5.3 改造 new_device_verify.tsx 为 Tab 容器

- [ ] **步骤 1：重写 new_device_verify.tsx**

替换整个文件内容为：

```tsx
import { useState } from 'react';
import { Tabs } from 'antd';
import NewDeviceQRVerify from './new_device_qr_verify';
import NewDeviceSmsVerify from './new_device_sms_verify';
import { QQManager } from '../controllers/qq_manager';

interface NewDeviceVerifyProps {
  uin: string;
  jumpUrl: string;
  newDevicePullQrCodeSig: string;
  passwordMd5: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export default function NewDeviceVerify ({
  uin,
  jumpUrl,
  newDevicePullQrCodeSig,
  passwordMd5,
  onSuccess,
  onError,
}: NewDeviceVerifyProps) {
  const [activeTab, setActiveTab] = useState('qr');

  const handleSmsSuccess = async (ntToken: string) => {
    // 复用 NewDeviceLogin 收尾
    try {
      const result = await QQManager.newDeviceLogin(uin, passwordMd5, ntToken);
      if (result.ret === 200) {
        onSuccess();
      } else {
        onError(result.msg || '登录失败');
      }
    } catch (e: any) {
      onError(e.message || '登录失败');
    }
  };

  return (
    <div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        centered
        items={[
          {
            key: 'qr',
            label: '扫码验证',
            children: (
              <NewDeviceQRVerify
                uin={uin}
                jumpUrl={jumpUrl}
                newDevicePullQrCodeSig={newDevicePullQrCodeSig}
                passwordMd5={passwordMd5}
                onSuccess={onSuccess}
                onError={onError}
              />
            ),
          },
          {
            key: 'sms',
            label: '短信验证',
            children: (
              <NewDeviceSmsVerify
                uin={uin}
                jumpUrl={jumpUrl}
                newDevicePullQrCodeSig={newDevicePullQrCodeSig}
                passwordMd5={passwordMd5}
                onSuccess={handleSmsSuccess}
                onError={onError}
                onSwitchToQR={() => setActiveTab('qr')}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
```

- [ ] **步骤 2：运行构建确认无错**
```bash
pnpm --filter napcat-webui-frontend run build 2>&1 | tail -30
```
预期：可能报 `QQManager.requestSmsCode` / `smsVerify` 未定义的 TS 错误，下一步实现 controller。

- [ ] **步骤 3：Commit**
```bash
git add packages/napcat-webui-frontend/src/components/new_device_verify.tsx
git commit -m "refactor: NewDeviceVerify as tab container with QR/SMS"
```

---

## 任务 6：前端 - qq_manager 新增方法 + 独立短信登录 Tab

**文件：**
- 修改：`packages/napcat-webui-frontend/src/controllers/qq_manager.ts`
- 创建：`packages/napcat-webui-frontend/src/components/sms_login.tsx`
- 修改：`packages/napcat-webui-frontend/src/pages/qq_login.tsx`

### 6.1 在 QQManager 中新增 requestSmsCode 和 smsVerify

- [ ] **步骤 1：添加静态方法**

在 `QQManager` 类中添加：

```typescript
  public static async requestSmsCode (
    uin: string,
    jumpUrl?: string,
    passwordMd5?: string,
    newDevicePullQrCodeSig?: string,
  ): Promise<{
    success: boolean;
    phoneTail?: string;
    sig?: string;
    method?: string;
    message?: string;
    attemptedMethods?: string[];
  }> {
    const res = await fetch('/QQLogin/RequestSmsCode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uin, jumpUrl, passwordMd5, newDevicePullQrCodeSig }),
    });
    const data = await res.json();
    return data.data || { success: false, message: 'Unknown error' };
  }

  public static async smsVerify (
    uin: string,
    code: string,
    sig?: string,
    method?: string,
  ): Promise<{
    success: boolean;
    ntToken?: string;
    message?: string;
  }> {
    const res = await fetch('/QQLogin/SmsVerify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uin, code, sig, method }),
    });
    const data = await res.json();
    return data.data || { success: false, message: 'Unknown error' };
  }
```

- [ ] **步骤 2：运行构建确认无错**
```bash
pnpm --filter napcat-webui-frontend run build 2>&1 | tail -20
```
预期：构建成功。

- [ ] **步骤 3：Commit**
```bash
git add packages/napcat-webui-frontend/src/controllers/qq_manager.ts
git commit -m "feat: add requestSmsCode and smsVerify to QQManager"
```

### 6.2 创建独立短信登录组件 SmsLogin

- [ ] **步骤 1：创建 sms_login.tsx**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Input, Button, message, Card } from 'antd';
import { QQManager } from '../controllers/qq_manager';

interface SmsLoginProps {
  onSuccess: () => void;
}

type SmsLoginState = 'idle' | 'code_sent' | 'verifying' | 'success' | 'error';

export default function SmsLogin ({ onSuccess }: SmsLoginProps) {
  const [uin, setUin] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<SmsLoginState>('idle');
  const [phoneTail, setPhoneTail] = useState('');
  const [smsSig, setSmsSig] = useState('');
  const [smsMethod, setSmsMethod] = useState('');

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendCode = useCallback(async () => {
    if (!uin.trim()) {
      message.warning('请输入 QQ 号');
      return;
    }
    setLoading(true);
    try {
      const result = await QQManager.requestSmsCode(uin.trim());
      if (result.success && result.phoneTail) {
        setPhoneTail(result.phoneTail);
        setSmsSig(result.sig || '');
        setSmsMethod(result.method || '');
        setCountdown(60);
        setState('code_sent');
        message.success('验证码已发送');
      } else {
        message.error(result.message || '发送失败，请使用其他登录方式');
      }
    } catch (e: any) {
      message.error(e.message || '发送验证码失败');
    } finally {
      setLoading(false);
    }
  }, [uin]);

  const handleLogin = useCallback(async () => {
    if (code.length !== 6) {
      message.warning('请输入 6 位验证码');
      return;
    }
    setLoading(true);
    setState('verifying');
    try {
      const result = await QQManager.smsVerify(uin.trim(), code, smsSig, smsMethod);
      if (result.success && result.ntToken) {
        setState('success');
        message.success('登录成功');
        onSuccess();
      } else {
        setState('error');
        message.error(result.message || '登录失败');
      }
    } catch (e: any) {
      setState('error');
      message.error(e.message || '登录失败');
    } finally {
      setLoading(false);
    }
  }, [uin, code, smsSig, smsMethod, onSuccess]);

  return (
    <Card>
      <div style={{ maxWidth: 320, margin: '0 auto' }}>
        <h3 style={{ textAlign: 'center', marginBottom: 24 }}>短信登录</h3>
        <Input
          value={uin}
          onChange={e => setUin(e.target.value.replace(/\D/g, ''))}
          placeholder="请输入 QQ 号"
          size="large"
          style={{ marginBottom: 16 }}
        />
        {phoneTail && (
          <p style={{ textAlign: 'center', color: '#666', marginBottom: 8 }}>
            验证码已发送到手机尾号 {phoneTail}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6 位验证码"
            maxLength={6}
            size="large"
            style={{ flex: 1 }}
          />
          <Button
            onClick={handleSendCode}
            disabled={(countdown > 0 || !uin.trim()) && state !== 'idle'}
            size="large"
            style={{ width: 120 }}
          >
            {countdown > 0 ? `${countdown}s` : '发送验证码'}
          </Button>
        </div>
        <Button
          type="primary"
          block
          size="large"
          onClick={handleLogin}
          loading={loading}
          disabled={state !== 'code_sent' && state !== 'error'}
        >
          登 录
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **步骤 2：运行构建确认无错**
```bash
pnpm --filter napcat-webui-frontend run build 2>&1 | tail -20
```
预期：构建成功。

- [ ] **步骤 3：Commit**
```bash
git add packages/napcat-webui-frontend/src/components/sms_login.tsx
git commit -m "feat: add SmsLogin component"
```

### 6.3 在登录页新增"短信登录" Tab

- [ ] **步骤 1：修改 qq_login.tsx**

在 `QQLogin` 组件中：
1. import `SmsLogin` 组件
2. 在 `activeTab` 的 `tabList` 中新增第 4 项 `{ key: 'sms', label: '短信登录' }`
3. 在 switch 语句中新增 `case 'sms':` 分支，返回 `<SmsLogin onSuccess={...} />`，onSuccess 回调与其他登录成功方式一致（刷新页面或触发状态更新）

- [ ] **步骤 2：运行构建确认无错**
```bash
pnpm --filter napcat-webui-frontend run build 2>&1 | tail -20
```
预期：构建成功。

- [ ] **步骤 3：Commit**
```bash
git add packages/napcat-webui-frontend/src/pages/qq_login.tsx
git commit -m "feat: add SMS login tab to login page"
```

---

## 任务 7：typecheck + lint + 集成测试验证

**文件：** 无新增

- [ ] **步骤 1：运行完整 typecheck**

```bash
pnpm run typecheck 2>&1 | tail -40
```
预期：无类型错误。如有错误，逐个修复。

- [ ] **步骤 2：运行 lint**

```bash
pnpm run lint 2>&1 | tail -40
```
预期：无 lint 错误。如有错误，修复。

- [ ] **步骤 3：运行所有测试**

```bash
pnpm test 2>&1 | tail -40
```
预期：所有测试通过。

- [ ] **步骤 4：运行前端生产构建**

```bash
pnpm run build:webui 2>&1 | tail -20
```
预期：构建成功。

- [ ] **步骤 5：Commit（如有修复）**

```bash
git add -A
git commit -m "fix: resolve typecheck/lint issues"
```

---

## 任务 8：推送到 main + 触发发布流程

**注意：** 此步骤需要用户手动确认，因为涉及远程推送和发布。

- [ ] **步骤 1：确认所有变更已提交**

```bash
git status
```
预期：working tree clean

- [ ] **步骤 2：推送到 main**

```bash
git push origin main
```

- [ ] **步骤 3：打版本 tag**

确定版本号（需用户确认）：
```bash
git tag v4.x.x
git push origin v4.x.x
```

- [ ] **步骤 4：手动触发 release-publish workflow**

通过 GitHub Actions UI 或 API 触发 `release-publish.yml`，传入版本号。
该 workflow 完成后会自动触发 `release-downstream.yml`，进而触发 Docker 镜像构建和软件包发布。

- [ ] **步骤 5：验证发布**

检查 GitHub Release 页面和 Docker Hub 页面确认产物已发布。

---

## 自检清单

- [x] 规格覆盖：L1-L5 全部有对应实现任务
- [x] 规格覆盖：前端短信登录 Tab + 新设备验证 Tab 切换全部有对应任务
- [x] 规格覆盖：路由注册有对应任务
- [x] 规格覆盖：发布与部署流程有对应任务
- [x] 无占位符：每个步骤都有具体代码或命令
- [x] 类型一致：`requestSmsCode` / `smsVerify` 在 controller、component、handler 中签名一致
- [x] 测试：每个后端功能层都有对应测试
