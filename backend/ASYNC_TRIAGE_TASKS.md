# 异步 Triage 任务系统

## 概述

`triage_tasks` 表用于跟踪异步邮件分类任务，支持：
1. **提交任务** - 创建任务并立即返回 task_id
2. **轮询状态** - 通过 task_id 查询任务进度
3. **获取结果** - 任务完成后从 `triage_results` 表获取结果

---

## 数据库设计

### `triage_tasks` 表

**字段说明：**
- `id` - 主键
- `user_id` - 用户 ID
- `task_id` - 唯一任务标识符（UUID，用于前端轮询）
- `status` - 任务状态：`pending`, `running`, `completed`, `failed`
- `thread_ids` - 要处理的 thread ID 数组（JSONB）
- `total_threads` - 总 thread 数量
- `processed_threads` - 已处理的 thread 数量（用于显示进度）
- `error_message` - 错误信息（如果失败）
- `created_at` - 创建时间
- `started_at` - 开始处理时间
- `completed_at` - 完成时间

**索引：**
- `task_id` (unique) - 快速查找任务
- `(user_id, status, created_at)` - 列出用户的任务

### `triage_results` 表

**新增字段：**
- `task_id` - 关联到 `triage_tasks.id`（可选，用于追踪结果来源）

---

## API 设计示例

### 1. 提交任务

```python
# POST /api/agent/triage/submit
async def submit_triage_task(
    user_id: int,
    thread_ids: List[str],
    db: AsyncSession
):
    """提交异步 triage 任务"""
    import uuid
    
    task_id = str(uuid.uuid4())
    task = TriageTask(
        user_id=user_id,
        task_id=task_id,
        status="pending",
        thread_ids=thread_ids,
        total_threads=len(thread_ids),
        processed_threads=0
    )
    db.add(task)
    await db.commit()
    
    # 触发后台任务（使用 Celery、BackgroundTasks 或 asyncio）
    # background_tasks.add_task(process_triage_task, task.id)
    
    return {
        "task_id": task_id,
        "status": "pending",
        "total_threads": len(thread_ids)
    }
```

### 2. 轮询任务状态

```python
# GET /api/agent/triage/status/{task_id}
async def get_triage_task_status(
    task_id: str,
    user_id: int,
    db: AsyncSession
):
    """查询任务状态"""
    task = await db.execute(
        select(TriageTask).where(
            TriageTask.task_id == task_id,
            TriageTask.user_id == user_id
        )
    )
    task = task.scalar_one_or_none()
    
    if not task:
        raise HTTPException(404, "Task not found")
    
    return {
        "task_id": task.task_id,
        "status": task.status,
        "total_threads": task.total_threads,
        "processed_threads": task.processed_threads,
        "progress": task.processed_threads / task.total_threads if task.total_threads > 0 else 0,
        "error_message": task.error_message,
        "created_at": task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at
    }
```

### 3. 获取任务结果

```python
# GET /api/agent/triage/results/{task_id}
async def get_triage_results(
    task_id: str,
    user_id: int,
    db: AsyncSession
):
    """获取任务结果"""
    # 先检查任务状态
    task = await db.execute(
        select(TriageTask).where(
            TriageTask.task_id == task_id,
            TriageTask.user_id == user_id
        )
    )
    task = task.scalar_one_or_none()
    
    if not task:
        raise HTTPException(404, "Task not found")
    
    if task.status != "completed":
        raise HTTPException(400, f"Task is not completed. Status: {task.status}")
    
    # 获取结果
    results = await db.execute(
        select(TriageResult).where(
            TriageResult.task_id == task.id,
            TriageResult.user_id == user_id
        )
    )
    results = results.scalars().all()
    
    return {
        "task_id": task.task_id,
        "status": task.status,
        "total_threads": task.total_threads,
        "results": [
            {
                "thread_id": r.thread_id,
                "label": r.label,
                "priority": r.priority,
                "summary": r.summary,
                "key_points": r.key_points
            }
            for r in results
        ]
    }
```

### 4. 后台任务处理函数

```python
async def process_triage_task(task_id: int, db: AsyncSession):
    """后台处理 triage 任务"""
    # 获取任务
    task = await db.get(TriageTask, task_id)
    if not task:
        return
    
    try:
        # 更新状态为 running
        task.status = "running"
        task.started_at = func.now()
        await db.commit()
        
        # 处理每个 thread
        for i, thread_id in enumerate(task.thread_ids):
            # 调用 triage agent 处理
            result = await triage_agent.process_thread(thread_id)
            
            # 保存结果
            triage_result = TriageResult(
                user_id=task.user_id,
                task_id=task.id,
                thread_id=thread_id,
                label=result["label"],
                priority=result["priority"],
                summary=result["summary"],
                key_points=result["key_points"]
            )
            db.add(triage_result)
            
            # 更新进度
            task.processed_threads = i + 1
            await db.commit()
        
        # 标记完成
        task.status = "completed"
        task.completed_at = func.now()
        await db.commit()
        
    except Exception as e:
        # 标记失败
        task.status = "failed"
        task.error_message = str(e)
        task.completed_at = func.now()
        await db.commit()
```

---

## 前端使用示例

### 提交任务

```javascript
// 提交任务
const response = await fetch('/api/agent/triage/submit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    thread_ids: ['thread1', 'thread2', 'thread3']
  })
});

const { task_id } = await response.json();
console.log('Task submitted:', task_id);
```

### 轮询状态

```javascript
// 轮询任务状态
async function pollTaskStatus(taskId) {
  const pollInterval = 2000; // 2秒轮询一次
  
  const poll = async () => {
    const response = await fetch(`/api/agent/triage/status/${taskId}`);
    const status = await response.json();
    
    console.log('Task status:', status.status);
    console.log('Progress:', status.progress);
    
    if (status.status === 'completed') {
      // 获取结果
      const resultsResponse = await fetch(`/api/agent/triage/results/${taskId}`);
      const results = await resultsResponse.json();
      console.log('Results:', results);
      return results;
    } else if (status.status === 'failed') {
      console.error('Task failed:', status.error_message);
      return null;
    } else {
      // 继续轮询
      setTimeout(poll, pollInterval);
    }
  };
  
  poll();
}
```

---

## 工作流程

```
1. 用户提交任务
   POST /api/agent/triage/submit
   → 返回 task_id

2. 后台任务开始处理
   - 更新 status = "running"
   - 逐个处理 thread_ids
   - 更新 processed_threads
   - 保存结果到 triage_results

3. 前端轮询状态
   GET /api/agent/triage/status/{task_id}
   → 返回 status, progress

4. 任务完成
   - 更新 status = "completed"
   - 前端获取结果
   GET /api/agent/triage/results/{task_id}
   → 返回所有 triage_results
```

---

## 索引优化

当前索引已优化：
- `task_id` (unique) - O(1) 查找任务
- `(user_id, status, created_at)` - 高效列出用户的任务
- `triage_results.task_id` - 快速获取任务结果

---

## 注意事项

1. **任务清理**：可以考虑定期清理旧的已完成任务（保留结果）
2. **并发控制**：确保同一用户不会同时运行多个 triage 任务
3. **错误处理**：任务失败时保留错误信息，方便调试
4. **进度更新**：`processed_threads` 可以实时更新，前端可以看到进度
