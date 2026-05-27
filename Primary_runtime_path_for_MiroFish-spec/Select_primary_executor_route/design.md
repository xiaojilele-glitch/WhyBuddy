python
def select_primary_route(route_set, target_repo):
    # 1. 过滤符合 executor-backed 条件的路径
    candidates = [r for r in route_set if r.type == "executor_backed_agent"]
    
    if not candidates:
        raise RouteNotFoundError("未找到匹配的角色代理执行路径")
    
    # 2. 选择主路径（逻辑可根据优先级或权重）
    primary_route = candidates[0] 
    
    # 3. 记录追踪元数据
    traceability_data = {
        "selected_route_id": primary_route.id,
        "kind": primary_route.kind,
        "title": primary_route.title,
        "summary": primary_route.summary
    }
    
    return traceability_data