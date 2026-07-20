# NapCat WebUI 短信验证码登录设计

- 日期：2026-07-20
- 主题：在 WebUI 登录页新增短信验证码登录入口，并改造密码登录的新设备验证环节，让用户能在扫码验证与短信验证之间切换
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
- 后端采用"低风险赌博"策略：尝试调用 `NodeIKernelLoginService` 上可能存在的隐藏方法（绕过 TS 类型检查），不主动发往腾讯服务器的瞎猜请求，避免账号风控

### 1.3 非目标

- 不修改 [NodeIKernelLoginService](file:///workspace/packages/napcat-core/services/NodeIKernelLoginService.ts) 类型定义
- 不替换现有的扫码验证流程（短信仅作为备选）
- 不实现高风险的 OIDB 协议瞎猜（避免触发腾讯风控）
- 不借助 VNC / 本地 QQ 客户端辅助登录（用户已明确否决）

## 2. 关键约束

### 2.1 协议层未知

- [NodeIKernelLoginService](file:///workspace/packages/napcat-core/services/NodeIKernelLoginService.ts#L64-L121) 接口未暴露任何短信验证码登录方法
- [NodeIKernelLoginListener](file:///workspace/packages/napcat-core/listeners/NodeIKernelLoginListener.ts) 没有短信相关回调
- 公开渠道查不到 QQNT 短信登录的 OIDB 命令号
- SnowLumi 项目通过 Docker 内置 Xvfb+VNC 跑真实 QQ 客户端"借道"完成短信登录，本设计明确不采用此方式

### 2.2 账号安全

- 严禁瞎发 OIDB 请求到腾讯服务器（可能触发风控导致 QQ 封号）
- 仅允许尝试本地内核对象上可能存在的方法调用（无网络请求，零风险）
- 失败时必须优雅回退到扫码验证

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

### 5.1 新增 Handler

在 [napcat-webui-backend/src/api/QQLogin.ts](file:///workspace/packages/napcat-webui-backend/src/api/QQLogin.ts) 新增 2 个 handler。

#### 5.1.1 `QQRequestSmsCodeHandler`

入参：

```typescript
{
  uin: string;
  jumpUrl?: string;                // 密码登录触发新设备验证时传入；独立短信登录入口不传
  passwordMd5?: string;            // 同上场景下传入（用户输入的密码 MD5）
  newDevicePullQrCodeSig?: string; // 同上场景下传入（passwordLogin 第一阶段返回的 sig）
}
```

处理流程（按顺序尝试）：

1. **尝试 1：调用 `NodeIKernelLoginService` 上可能存在的隐藏方法**
   - 通过 `any` 绕过类型检查
   - 候选方法名：`requestSmsCode` / `loginSms` / `sendSmsCode` / `sendSmsVerifyCode`
   - 调用时传入 `{ uin, jumpUrl }` 或对应参数
   - 如果方法存在且返回成功 → 解析返回值，提取 `phoneTail` 和 `sig`，返回 `{ success: true, phoneTail, sig }`
   - 如果方法不存在或抛异常 → 进入尝试 2
2. **尝试 2：调用 `passwordLogin` 携带特殊 step**
   - 仅当 `jumpUrl` 存在时执行（独立短信登录入口无 jumpUrl，跳过此步）
   - 此场景下密码登录已成功触发新设备验证，前端会同时把用户输入的 `passwordMd5`、`newDevicePullQrCodeSig` 一并传给 `RequestSmsCode`，因此入参字段需扩展为 `{ uin, jumpUrl?, passwordMd5?, newDevicePullQrCodeSig? }`
   - 调用 `passwordLogin({ uin, passwordMd5, step: 1, newDeviceLoginSig, ... })`，观察返回的 `loginErrorInfo` 是否出现短信相关字段（如 `smsPhoneTail` / `smsSig`）
   - 如果出现 → 返回 `{ success: true, phoneTail, sig }`
   - 否则 → 进入失败分支
3. **失败分支**
   - 返回 `{ success: false, message: '短信登录暂不可用，请使用扫码登录' }`
   - 同时通过 [napcat-core 的 log](file:///workspace/packages/napcat-core/src/helper/log.ts) 打印详细日志，便于调试

出参：

```typescript
{
  success: boolean;
  phoneTail?: string;  // 手机号后 4 位，用于提示用户
  sig?: string;        // 后续 SmsVerify 需要的令牌
  message?: string;    // 失败时的提示
}
```

#### 5.1.2 `QQSmsVerifyHandler`

入参：

```typescript
{
  uin: string;
  code: string;  // 6 位短信验证码
  sig?: string;  // RequestSmsCode 返回的 sig
}
```

处理流程：

1. **尝试调用 `NodeIKernelLoginService` 上可能存在的隐藏方法**
   - 候选方法名：`submitSmsCode` / `verifySmsCode` / `loginSmsVerify`
   - 调用时传入 `{ uin, code, sig }`
   - 成功 → 解析返回值，提取 `ntToken`，返回 `{ success: true, ntToken }`
   - 失败 → 返回 `{ success: false, message: '短信验证失败，请使用扫码登录' }` + 日志

出参：

```typescript
{
  success: boolean;
  ntToken?: string;  // 后续传给 NewDeviceLogin 的 newDevicePullQrCodeSig
  message?: string;
}
```

### 5.2 路由注册

在 [napcat-webui-backend/src/router/QQLogin.ts](file:///workspace/packages/napcat-webui-backend/src/router/QQLogin.ts) 注册 2 个新路由：

```typescript
router.post('/RequestSmsCode', QQRequestSmsCodeHandler);
router.post('/SmsVerify', QQSmsVerifyHandler);
```

### 5.3 日志输出

所有尝试过程都通过 NapCat 现有日志系统输出 `info` / `warn` 级别日志，包含：
- 尝试的方法名
- 方法是否存在
- 调用结果（成功 / 抛异常 / 字段缺失）
- 失败原因

日志可在 WebUI 日志页查看，便于用户"当小白鼠"时判断哪条路径有可能跑通。

## 6. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 用户在短信 Tab 点"发送验证码"但后端返回失败 | toast 提示"短信登录暂不可用，请使用扫码登录"，2 秒后自动切回扫码 Tab |
| 用户输入验证码提交后端失败 | toast 提示具体错误信息，停留在短信 Tab 允许重试 |
| 后端隐藏方法调用抛异常 | catch 异常，记录日志，进入下一个尝试 / 失败分支 |
| 60 秒倒计时未结束用户重复点击"发送验证码" | 按钮禁用，不发送请求 |
| 短信验证通过但后续 NewDeviceLogin 失败 | 沿用现有 NewDeviceLogin 的错误处理逻辑 |

## 7. 测试

### 7.1 前端单元测试

- `NewDeviceVerify` 容器组件在 Tab 切换时正确装载/卸载子组件，卸载时清理定时器
- `NewDeviceSmsVerify` 的 60 秒倒计时逻辑：点击后立即禁用，倒计时结束后恢复
- `SmsLogin` 状态机流转：`idle → code_sent → verifying → success/error`
- 后端返回 `success: false` 时正确显示 toast 并切回扫码 Tab

### 7.2 后端单元测试

- `QQRequestSmsCodeHandler`：mock `NodeIKernelLoginService`，验证隐藏方法不存在时正确返回失败
- `QQRequestSmsCodeHandler`：mock 隐藏方法存在并返回成功时，正确解析 `phoneTail` / `sig`
- `QQSmsVerifyHandler`：同上两类场景
- 日志输出格式正确

### 7.3 集成验证（用户手动测试）

启动 NapCat WebUI，用真实 QQ 号测试：
1. 进入"短信登录"Tab，输入 QQ 号，点击"发送验证码"，观察 WebUI 日志页输出
2. 进入"密码登录"Tab，输入 QQ 号 + 密码，触发新设备验证，切到"短信验证"子 Tab，重复测试
3. 根据日志判断哪条尝试路径有可能跑通，作为后续协议层补全的依据

## 8. 范围与后续

### 8.1 本次范围

- 前端 UI 完整改造（登录页新 Tab + 新设备验证 Tab 切换）
- 后端 2 个新接口的"低风险赌博"实现
- 单元测试覆盖
- 详细日志输出

### 8.2 后续工作（不在本次范围）

- 通过抓包 QQNT 桌面客户端走短信登录的真实请求，逆向出 OIDB 命令号和 protobuf 结构
- 用真实协议替换后端的"赌博式尝试"
- 如果发现 NTQQ 内核新版本暴露了短信登录 API，补全 [NodeIKernelLoginService](file:///workspace/packages/napcat-core/services/NodeIKernelLoginService.ts) 类型定义
