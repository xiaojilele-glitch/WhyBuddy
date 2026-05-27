typescript
interface BindRequest {
  plan_id: string;               // 执行计划ID
  route_path: "MiroFish_Path";   // 目标路线
  role_instructions: string;     // 角色指令
  credentials_ref: string[];     // 凭证引用列表
  callback_urls: CallbackConfig; // 回调配置
}

interface BindingResult {
  session_id: string;            // 隔离会话ID
  backend_endpoint: string;      // 执行后端地址
  status: "ready" | "failed";
}