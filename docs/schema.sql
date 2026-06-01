-- ============================================================
-- WhyBuddy — MySQL Schema
-- 多智能体 LLM 编排系统数据库
-- ============================================================

CREATE DATABASE IF NOT EXISTS whybuddy
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE whybuddy;

-- ============================================================
-- 1. 智能体定义（对应三文件规范）
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  department ENUM('game','ai','life','meta') NOT NULL,
  role ENUM('ceo','manager','worker') NOT NULL,
  manager_id VARCHAR(32) DEFAULT NULL,
  model VARCHAR(64) DEFAULT 'gpt-4o',
  soul_md TEXT,
  heartbeat_config JSON,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_department (department),
  INDEX idx_role (role),
  FOREIGN KEY (manager_id) REFERENCES agents(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- 2. 工作流运行记录
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_runs (
  id VARCHAR(36) PRIMARY KEY,
  directive TEXT NOT NULL,
  status ENUM('pending','running','completed','failed') DEFAULT 'pending',
  current_stage VARCHAR(32) DEFAULT NULL,
  departments_involved JSON,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  results JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- ============================================================
-- 3. 智能体间消息
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id VARCHAR(36) NOT NULL,
  from_agent VARCHAR(32) NOT NULL,
  to_agent VARCHAR(32) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_workflow (workflow_id),
  INDEX idx_to_agent (to_agent, workflow_id),
  INDEX idx_stage (workflow_id, stage),
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 4. 任务分配与评分
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id VARCHAR(36) NOT NULL,
  worker_id VARCHAR(32) NOT NULL,
  manager_id VARCHAR(32) NOT NULL,
  department ENUM('game','ai','life','meta') NOT NULL,
  description TEXT NOT NULL,
  deliverable MEDIUMTEXT,
  deliverable_v2 MEDIUMTEXT,
  deliverable_v3 MEDIUMTEXT,
  score_accuracy TINYINT UNSIGNED,
  score_completeness TINYINT UNSIGNED,
  score_actionability TINYINT UNSIGNED,
  score_format TINYINT UNSIGNED,
  total_score TINYINT UNSIGNED,
  manager_feedback TEXT,
  meta_audit_feedback TEXT,
  verify_result JSON,
  version TINYINT UNSIGNED DEFAULT 1,
  status ENUM('assigned','executing','submitted','reviewed',
              'audited','revising','verified','passed','failed') DEFAULT 'assigned',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_workflow (workflow_id),
  INDEX idx_worker (worker_id),
  INDEX idx_status (status),
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 5. 进化日志（M7-1 绩效反馈闭环）
-- ============================================================
CREATE TABLE IF NOT EXISTS evolution_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(32) NOT NULL,
  workflow_id VARCHAR(36),
  dimension VARCHAR(32),
  old_score DECIMAL(3,1),
  new_score DECIMAL(3,1),
  patch_content TEXT,
  applied TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent (agent_id),
  INDEX idx_workflow (workflow_id)
) ENGINE=InnoDB;

-- ============================================================
-- 6. 关键词学习表（M7-2）
-- ============================================================
CREATE TABLE IF NOT EXISTS heartbeat_keywords (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(32) NOT NULL,
  keyword VARCHAR(128) NOT NULL,
  category ENUM('effective','neutral','ineffective') DEFAULT 'neutral',
  correlation DECIMAL(4,3) DEFAULT 0.000,
  occurrence_count INT UNSIGNED DEFAULT 0,
  last_seen_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_agent_keyword (agent_id, keyword),
  INDEX idx_agent (agent_id)
) ENGINE=InnoDB;

-- ============================================================
-- 7. 能力注册表（M7-3）
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_capabilities (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(32) NOT NULL,
  capability VARCHAR(256) NOT NULL,
  confidence DECIMAL(4,3) DEFAULT 0.500,
  demo_count INT UNSIGNED DEFAULT 0,
  last_demonstrated_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_agent_cap (agent_id, capability(191)),
  INDEX idx_agent (agent_id),
  INDEX idx_confidence (confidence DESC)
) ENGINE=InnoDB;

-- ============================================================
-- 种子数据：18 个智能体
-- ============================================================
INSERT INTO agents (id, name, department, role, manager_id, model) VALUES
-- CEO (无部门归属，用 meta 代替)
('ceo', 'CEO Gateway', 'meta', 'ceo', NULL, 'gpt-4o'),

-- 游戏部
('pixel', 'Pixel (游戏部经理)', 'game', 'manager', 'ceo', 'gpt-4o'),
('nova',  'Nova',  'game', 'worker', 'pixel', 'gpt-4o-mini'),
('blaze', 'Blaze', 'game', 'worker', 'pixel', 'gpt-4o-mini'),
('lyra',  'Lyra',  'game', 'worker', 'pixel', 'gpt-4o-mini'),
('volt',  'Volt',  'game', 'worker', 'pixel', 'gpt-4o-mini'),

-- AI 部
('nexus',  'Nexus (AI部经理)', 'ai', 'manager', 'ceo', 'gpt-4o'),
('flux',   'Flux',   'ai', 'worker', 'nexus', 'gpt-4o-mini'),
('tensor', 'Tensor', 'ai', 'worker', 'nexus', 'gpt-4o-mini'),
('quark',  'Quark',  'ai', 'worker', 'nexus', 'gpt-4o-mini'),
('iris',   'Iris',   'ai', 'worker', 'nexus', 'gpt-4o-mini'),

-- 生活部
('echo', 'Echo (生活部经理)', 'life', 'manager', 'ceo', 'gpt-4o'),
('zen',  'Zen',  'life', 'worker', 'echo', 'gpt-4o-mini'),
('coco', 'Coco', 'life', 'worker', 'echo', 'gpt-4o-mini'),

-- 元部门
('warden', 'Warden (元部门经理)', 'meta', 'manager', 'ceo', 'gpt-4o'),
('forge',  'Forge (流程分析师)',  'meta', 'worker', 'warden', 'gpt-4o-mini'),
('prism',  'Prism (质量分析师)',  'meta', 'worker', 'warden', 'gpt-4o-mini'),
('scout',  'Scout (绩效分析师)',  'meta', 'worker', 'warden', 'gpt-4o-mini')
ON DUPLICATE KEY UPDATE name = VALUES(name);
