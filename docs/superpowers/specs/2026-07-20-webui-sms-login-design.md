# NapCat WebUI 短信验证码登录设计（全量高风险版）

- 日期：2026-07-20
- 主题：在 WebUI 登录页新增短信验证码登录入口，并改造密码登录的新设备验证环节，让用户能在扫码验证与短信验证之间切换。**采用"不惜一切代价"策略**：穷尽所有可行的 OIDB 协议尝试与内核方法尝试。
- 状态：已通过设计评审，待编写实现计划

## 1. 背景与目标

### 1.1 现状

NapCat 当前的 WebUI 登录页（[qq_login.tsx](file:///workspace/packages/napcat-webui-frontend/src/pages/qq_login.tsx)）提供 3 种登录方式：

1. 快速登录（从历史已登录 QQ 列表选择）
2. 密码登录（QQ 号 + 密码 → 可能触发滑块验证 → 可能触发新设备验证）
3. 扫码登录

其中"密码登录"触发新设备验证时，[QQNewDeviceLoginHandler](file:///workspace/packages/napcat-webui-backend/src/api/QQLogin.ts#L244-L265) 走的是 OIDB 拉二维码流程（[QQGetNewDeviceQRCodeHandler](file:///workspace/packages/napcat-webui-backend/src/api/QQLogin.ts#L506-L534) → 调 `oidb.tim.qq.com` 的 `oidb_0xc9e_8`），用户必须扫码完成验证。用户反馈："现在的密码登录还是需要扫码"，希望增加短信验证码方式。

### 1.2 目标

- 在 WebUI 登录页新增独立的"短信登录"Tab
- 在密码登录触发新设备验证的环节，把当前只支持扫码的 [NewDeviceVerify](file:///workspace/packages/napcat-webui-frontend/src/components/new_device_verify.tsx) 组件改造为支持"扫码验证 | 短信验证"切换
- 后端新增 2 个接口：`/QQLogin/RequestSmsCode` 和 `/QQLogin/SmsVerify`
- **穷尽所有可行的协议尝试**：OIDB 协议全量命令号扫描、内核隐藏方法枚举、passwordLogin step 参数穷举
- 代码合入 main 后自动触发 Docker 镜像构建与软件包发布

### 1.3 非目标

- 不修改 [NodeIKernelLoginService](file:///workspace/packages/napcat-core/services/NodeIKernelLoginService.ts) 类型定义（但运行时用 any 绕过）
- 不替换现有的扫码验证流程（短信仅作为备选）
- 不借助 VNC / 本地 QQ 客户端辅助登录（用户已明确否决）
- 不修改已有 CI/CD 流水线的结构，仅触发现有流程

## 2. 关键约束

### 2.1 协议层未知

- [NodeIKernelLoginService](file:///workspace/packages/napcat-core/services/NodeIKernelLoginService.ts#L64-L121) 接口未暴露任何短信验证码登录方法
- [NodeIKernelLoginListener](file:///workspace/packages/napcat-core/listeners/NodeIKernelLoginListener.ts) 没有短信相关回调
- 公开渠道查不到 QQNT 短信登录的 OIDB 命令号
- SnowLumi 项目通过 Docker 内置 Xvfb+VNC 跑真实 QQ 客户端"借道"完成短信登录，本设计明确不采用此方式

### 2.2 账号安全

- **用户明确接受高风险**：不惜一切代价尝试所有可能的协议路径
- 失败时必须优雅回退到扫码验证
- 所有尝试都记录详细日志，便于排查

### 2.3 发布约束

- 本仓库不包含 Dockerfile，Docker 镜像构建在下游仓库（NapCat-Docker / NapCat.Docker.Framework）
- 软件包发布通过 [release-publish.yml](file:///workspace/.github/workflows/release-publish.yml) 手动触发（需指定版本 tag）
- 代码合并到 main 后，可通过 GitHub Actions API 触发下游 Docker 构建

## 3. 架构与数据流

### 3.1 改造后数据流

```
前端 passwordLogin(uin, md5)
  → 后端 /QQLogin/PasswordLogin  (不变)
  → 返回 { needNewDevice, jumpUrl, newDevicePullQrCodeSig }

前端 NewDeviceVerify 容器组件 (Tab 切换: 扫码 | 短信)
  ├─ 扫码 Tab: NewDeviceQRVerify (原逻辑搬迁)
  │    → /QQLogin/GetNewDeviceQRCode (不变)
  │    → /QQLogin/PollNewDeviceQR     (不变)
  │    → 拿到 str_nt_succ_token
  │    → /QQLogin/NewDeviceLogin      (不变)
  │    → 登录完成
  └─ 短信 Tab: NewDeviceSmsVerify (新增)
       → /QQLogin/RequestSmsCode(uin, jumpUrl)  [新增]
       → 后端尝试调用可能存在的隐藏方法 / passwordLogin(step=1)
       → 返回 { success, phoneTail?, message? }
       → 用户输入收到的验证码
       → /QQLogin/SmsVerify(uin, code, sig?)    [新增]
       → 后端尝试调用可能存在的隐藏方法
       → 返回 { success, ntToken?, message? }
       → 前端拿 ntToken 作为 newDevicePullQrCodeSig
       → /QQLogin/NewDeviceLogin(uin, md5, sig)  (复用现有)
       → 登录完成

前端独立"短信登录"Tab (新增)
  → 用户输入 QQ 号
  → /QQLogin/RequestSmsCode(uin)  (jumpUrl 不传)
  → 用户输入验证码
  → /QQLogin/SmsVerify(uin, code)
  → 后端如果支持则返回登录令牌；不支持则返回失败提示
```

### 3.2 关键设计决策

1. **复用 [NewDeviceLogin](file:///workspace/packages/napcat-webui-backend/src/api/QQLogin.ts#L244-L265) 收尾**：短信验证通过后拿到的 `ntToken` 仍然作为 `newDevicePullQrCodeSig` 传给 `NewDeviceLogin`，与扫码流程汇合。短信只负责"换一种方式拿令牌"，不影响后续登录链路。
2. **协议层与 UI 层解耦**：前端只调 `RequestSmsCode` / `SmsVerify` 两个抽象接口，后端可以无感替换实现（隐藏方法尝试 → 抓包拿到真实协议后接入 OIDB）。
3. **不修改 NTQQ LoginService 类型**：避免影响其他登录方式。后端通过 `any` 绕过类型检查调用可能存在的隐藏方法。

## 4. 前端设计

### 4.1 登录页 [qq_login.tsx](file:///workspace/packages/napcat-webui-frontend/src/pages/qq_login.tsx) 改造

- 在现有 3 个 Tab（快速登录 / 密码登录 / 扫码登录）之后新增第 4 个 Tab："短信登录"
- 新 Tab 内嵌新组件 `SmsLogin`
- 现有的 `onPasswordSubmit` / `onNewDeviceVerified` 等回调保持不变

### 4.2 新设备验证组件改造

把现有 [new_device_verify.tsx](file:///workspace/packages/napcat-webui-frontend/src/components/new_device_verify.tsx) 拆分为 3 个文件：

- `new_device_verify.tsx`：容器组件，含 Tab 切换逻辑，对外 props 不变（保持 [password_login.tsx](file:///workspace/packages/napcat-webui-frontend/src/components/password_login.tsx) 调用方零改动）
- `new_device_qr_verify.tsx`：原扫码逻辑整体搬迁
- `new_device_sms_verify.tsx`：新增短信验证子组件

容器组件默认选中"扫码验证"Tab，不破坏现有流程。

### 4.3 新组件：`SmsLogin`（独立短信登录 Tab）

状态机：`idle → code_sent → verifying → success | error`

UI 元素：
- QQ 号输入框
- "发送验证码"按钮（点击后进入 60 秒倒计时，倒计时期间禁用）
- 验证码输入框（6 位数字，倒计时结束后才能提交）
- "登录"按钮
- 错误提示文本

### 4.4 新组件：`NewDeviceSmsVerify`（新设备验证的短信 Tab）

UI 元素：
- 提示文本"验证码将发送到该 QQ 绑定的手机"
- "发送验证码"按钮 + 60 秒倒计时
- 验证码输入框
- "登录"按钮
- "取消验证"按钮（与扫码 Tab 一致）

### 4.5 [qq_manager.ts](file:///workspace/packages/napcat-webui-frontend/src/controllers/qq_manager.ts) 新增方法

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
  message?: string;
}>;

public static async smsVerify (uin: string, code: string, sig?: string): Promise<{
  success: boolean;
  ntToken?: string;
  message?: string;
}>;
```

> 独立"短信登录"Tab 调用时只传 `uin`；新设备验证的短信子 Tab 调用时传全 4 个参数。

## 5. 后端设计

### 5.1 尝试策略总览

后端采用"分层尝试、穷尽路径"策略，按风险从低到高依次尝试：

| 层级 | 尝试方式 | 风险等级 | 说明 |
|------|----------|----------|------|
| L1 | 内核隐藏方法调用 | 极低 | 纯本地 JS 调用，不发网络请求 |
| L2 | passwordLogin step 穷举 | 低 | 走已知的 passwordLogin 接口，换不同 step 值 |
| L3 | OIDB 已知命令号变体 | 中 | 基于已知的 0xc9e_8 变体，尝试相邻/相关命令号 |
| L4 | OIDB 短信相关命令号扫描 | 较高 | 扫描疑似短信登录的 OIDB 命令号范围 |
| L5 | accounts.qq.com 短信接口 | 中 | 尝试 QQ 账号安全中心的 Web 短信接口 |

**执行规则**：
- 从 L1 开始依次尝试，某一层成功则立即返回
- 每一层失败后记录日志，进入下一层
- 所有层都失败后返回统一错误
- 每次调用都有超时保护（5 秒）和异常捕获

### 5.2 新增 Handler

在 [napcat-webui-backend/src/api/QQLogin.ts](file:///workspace/packages/napcat-webui-backend/src/api/QQLogin.ts) 新增 2 个 handler，内部实现为分层尝试器。

#### 5.2.1 `QQRequestSmsCodeHandler`

入参：

```typescript
{
  uin: string;
  jumpUrl?: string;                // 密码登录触发新设备验证时传入；独立短信登录入口不传
  passwordMd5?: string;            // 同上场景下传入（用户输入的密码 MD5）
  newDevicePullQrCodeSig?: string; // 同上场景下传入（passwordLogin 第一阶段返回的 sig）
}
```

处理流程（分层尝试）：

**L1：内核隐藏方法调用**
- 通过 `any` 绕过类型检查
- 候选方法名（逐个尝试）：
  - `requestSmsCode` / `sendSmsCode` / `sendSmsVerifyCode`
  - `loginSms` / `loginWithSms` / `smsLogin`
  - `requestMobileCode` / `sendMobileVerifyCode`
  - `getSmsCode` / `fetchSmsCode`
  - `verifySms`（先试发送再试验证，不行则跳过）
- 调用时尝试不同参数形式：`(uin)` / `({ uin })` / `({ uin, jumpUrl })`
- 成功 → 解析返回值，提取 `phoneTail` 和 `sig`，返回 `{ success: true, phoneTail, sig, method: 'kernel_xxx' }`
- 失败 → 进入 L2

**L2：passwordLogin step 穷举**
- 仅当 `passwordMd5` 存在时执行
- 尝试 step 值：1、2、3、10、11、20、100（常见二次认证步骤值）
- 对每个 step 调用 `passwordLogin({ uin, passwordMd5, step, ... })`
- 检查返回的 `loginErrorInfo` 是否出现短信相关字段（`smsPhoneTail` / `smsSig` / `mobileTail` / `phoneLast4` 等）
- 匹配到 → 返回 `{ success: true, phoneTail, sig, method: 'passwordLogin_step_N' }`
- 全部不匹配 → 进入 L3

**L3：OIDB 已知命令号变体**
- 基于现有的 `oidb_0xc9e_8`（新设备验证 QR 码接口），尝试变体：
  - `oidb_0xc9e_1` ~ `oidb_0xc9e_20`（同 command 不同 subcmd）
  - `oidb_0xc9d_N` / `oidb_0xc9f_N`（相邻 command）
  - 请求体在现有 body 基础上增加/修改 `uint32_flag` 为疑似短信验证的值
- 使用 [QQLogin.ts](file:///workspace/packages/napcat-webui-backend/src/api/QQLogin.ts#L12-L40) 中已有的 `oidbRequest` 辅助函数
- 检查响应中是否有 `str_phone_tail` / `str_sms_sig` 等字段
- 匹配到 → 返回成功 + phoneTail + sig + method
- 失败 → 进入 L4

**L4：OIDB 短信相关命令号扫描**
- 扫描疑似短信登录的 OIDB 命令号范围（每次最多 20 个，避免触发风控）
- 候选范围：
  - `0xc9e_*` 系列（已在 L3 覆盖高频）
  - `0xdxx_*` 系列（登录/安全相关常见区域）
  - `0x11xx_*` 系列
- 请求体使用通用结构：`{ uint32_flag: 1, str_uin_token: uin }`
- 每个命令号发一次请求，检查响应
- 任何一个命中 → 立即停止扫描，返回成功
- 全部未命中 → 进入 L5

**L5：accounts.qq.com Web 短信接口**
- 尝试 QQ 账号安全中心的 Web 接口（`https://accounts.qq.com/safe/verify` 等）
- 从 jumpUrl 中提取 token 参数，模拟网页端发送短信的请求
- 成功 → 返回 phoneTail + sig
- 失败 → 全部尝试结束

**失败分支（全部尝试失败）**
- 返回 `{ success: false, message: '短信登录暂不可用，请使用扫码登录', attemptedMethods: [...] }`
- 详细日志输出每一层的尝试结果

出参：

```typescript
{
  success: boolean;
  phoneTail?: string;   // 手机号后 4 位
  sig?: string;         // 后续 SmsVerify 需要的令牌
  method?: string;      // 成功时使用的方法标识，用于日志
  message?: string;     // 失败时的提示
  attemptedMethods?: string[]; // 已尝试的方法列表，调试用
}
```

#### 5.2.2 `QQSmsVerifyHandler`

入参：

```typescript
{
  uin: string;
  code: string;   // 6 位短信验证码
  sig?: string;   // RequestSmsCode 返回的 sig
  method?: string; // RequestSmsCode 成功时返回的 method，用于决定用哪种验证方式
}
```

处理流程：

1. 如果 `method` 存在（RequestSmsCode 成功时传入），使用对应方法验证
2. 如果 `method` 不存在，分层尝试（同 RequestSmsCode 的 L1→L5 思路）
3. 成功 → 提取 `ntToken` / `str_nt_succ_token`，返回 `{ success: true, ntToken }`
4. 失败 → 返回 `{ success: false, message: '短信验证失败，请使用扫码登录' }` + 日志

出参：

```typescript
{
  success: boolean;
  ntToken?: string;  // 后续传给 NewDeviceLogin 的 newDevicePullQrCodeSig
  message?: string;
}
```

### 5.3 路由注册

在 [napcat-webui-backend/src/router/QQLogin.ts](file:///workspace/packages/napcat-webui-backend/src/router/QQLogin.ts) 注册 2 个新路由：

```typescript
router.post('/RequestSmsCode', QQRequestSmsCodeHandler);
router.post('/SmsVerify', QQSmsVerifyHandler);
```

### 5.4 日志输出

所有尝试过程都通过 NapCat 现有日志系统输出 `info` / `warn` 级别日志，包含：
- 尝试的层级（L1-L5）和具体方法名
- 方法/接口是否存在
- 请求参数（脱敏：密码 MD5 打码）
- 响应结果摘要（成功 / 失败 / 字段名）
- 耗时
- 失败原因

日志可在 WebUI 日志页查看，便于用户"当小白鼠"时判断哪条路径有可能跑通。

## 6. 发布与部署

### 6.1 发布流程

代码合入 main 后，按以下步骤触发发布：

1. **打 tag**：在 main 分支上打版本 tag（如 `v4.x.x`），触发 [release-tag.yml](file:///workspace/.github/workflows/release-tag.yml)
2. **构建发布**：手动触发 [release-publish.yml](file:///workspace/.github/workflows/release-publish.yml)，指定版本号
3. **下游构建**：release-publish 完成后自动触发 [release-downstream.yml](file:///workspace/.github/workflows/release-downstream.yml)，包括：
   - Shell Docker（NapCat-Docker 仓库）
   - Framework Docker（NapCat.Docker.Framework 仓库）
   - AppImage 构建
   - NodeLoader 构建 + Docker
4. **OpenAPI Schema 发布**：同步到 NapCatDocs 仓库

### 6.2 Docker 镜像

- **Shell Docker**：在 `NapNeko/NapCat-Docker` 仓库构建，由 [release-downstream.yml](file:///workspace/.github/workflows/release-downstream.yml#L88-L99) 触发
- **Framework Docker**：在 `NapNeko/NapCat.Docker.Framework` 仓库构建，由 [release-downstream.yml](file:///workspace/.github/workflows/release-downstream.yml#L101-L112) 触发
- 本仓库不包含 Dockerfile，Docker 镜像构建逻辑在下游仓库

### 6.3 软件包

发布产物（见 [release-publish.yml](file:///workspace/.github/workflows/release-publish.yml#L404-L415)）：
- `NapCat.Shell.zip` — Shell 模式
- `NapCat.Framework.zip` — Framework 模式
- `NapCat.Shell.Windows.Node.zip` — Windows 一键包（内置 Node.js + QQ）
- `NapCat.Shell.Windows.OneKey.zip` — Windows 完整一键包

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 用户在短信 Tab 点"发送验证码"但后端返回失败 | toast 提示"短信登录暂不可用，请使用扫码登录"，2 秒后自动切回扫码 Tab |
| 用户输入验证码提交后端失败 | toast 提示具体错误信息，停留在短信 Tab 允许重试 |
| 后端任何层尝试抛异常 | catch 异常，记录日志，进入下一层尝试 / 最终失败分支 |
| 60 秒倒计时未结束用户重复点击"发送验证码" | 按钮禁用，不发送请求 |
| 短信验证通过但后续 NewDeviceLogin 失败 | 沿用现有 NewDeviceLogin 的错误处理逻辑 |
| OIDB 请求超时（>5 秒） | 标记失败，进入下一层尝试 |

## 8. 测试

### 8.1 前端单元测试

- `NewDeviceVerify` 容器组件在 Tab 切换时正确装载/卸载子组件，卸载时清理定时器
- `NewDeviceSmsVerify` 的 60 秒倒计时逻辑：点击后立即禁用，倒计时结束后恢复
- `SmsLogin` 状态机流转：`idle → code_sent → verifying → success/error`
- 后端返回 `success: false` 时正确显示 toast 并切回扫码 Tab

### 8.2 后端单元测试

- `QQRequestSmsCodeHandler` L1：mock `NodeIKernelLoginService`，验证隐藏方法不存在时正确进入 L2
- `QQRequestSmsCodeHandler` L1：mock 隐藏方法存在并返回成功时，正确解析 `phoneTail` / `sig`
- `QQRequestSmsCodeHandler` L3/L4：mock `oidbRequest`，验证返回体中包含短信字段时能正确识别
- `QQSmsVerifyHandler`：同上两类场景
- 分层尝试器：验证按 L1→L2→L3→L4→L5 顺序调用，某层成功后停止后续尝试
- 超时保护：验证单次请求超过 5 秒时正确超时
- 日志输出格式正确

### 8.3 集成验证（用户手动测试）

启动 NapCat WebUI，用真实 QQ 号测试：
1. 进入"短信登录"Tab，输入 QQ 号，点击"发送验证码"，观察 WebUI 日志页输出
2. 进入"密码登录"Tab，输入 QQ 号 + 密码，触发新设备验证，切到"短信验证"子 Tab，重复测试
3. 根据日志判断哪条尝试路径有可能跑通，作为后续协议层补全的依据
4. 如果某层成功收到短信验证码，记录 method 名称和返回字段，用于后续优化

## 9. 范围与后续

### 9.1 本次范围

- 前端 UI 完整改造（登录页新 Tab + 新设备验证 Tab 切换）
- 后端 2 个新接口的全量分层尝试实现（L1-L5）
- 单元测试覆盖
- 详细日志输出
- 代码合入 main 后触发 Docker 镜像构建与软件包发布

### 9.2 后续工作

- 根据用户小白鼠测试结果，确认哪层方法有效，针对性优化
- 通过抓包 QQNT 桌面客户端走短信登录的真实请求，逆向出精确的 OIDB 命令号和 protobuf 结构
- 用真实协议替换"赌博式尝试"中无效的层级
- 如果发现 NTQQ 内核新版本暴露了短信登录 API，补全 [NodeIKernelLoginService](file:///workspace/packages/napcat-core/services/NodeIKernelLoginService.ts) 类型定义
