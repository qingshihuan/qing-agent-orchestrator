import type { TaskCategory } from "./types.js";

export interface Classification {
  category: TaskCategory;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  recommendedExecution: "planner_only" | "read_only" | "workspace_write" | "human_gated" | "split_task";
}

const rules: Array<{ category: TaskCategory; pattern: RegExp; reason: string }> = [
  { category: "external_action", pattern: /发送|发布|通知|邮件|消息|send|publish|email|message/i, reason: "包含对外发送或发布动作" },
  { category: "infrastructure", pattern: /部署|生产环境|数据库迁移|服务器|deploy|production|migration|terraform|kubernetes/i, reason: "包含基础设施或生产环境动作" },
  { category: "code_change", pattern: /实现|修复|重构|写代码|修改代码|build|implement|fix|refactor|code/i, reason: "包含代码实现或修改" },
  { category: "content_creation", pattern: /文档|报告|演示|设计稿|document|report|presentation|copywriting/i, reason: "目标是创建内容型产物" },
  { category: "analysis", pattern: /分析|诊断|审查|评估|检查|核对|analy[sz]e|diagnose|review|assess|inspect|audit/i, reason: "目标以分析和判断为主" },
  { category: "advice", pattern: /解释|建议|怎么做|是什么|explain|advise|how to|what is/i, reason: "目标以解释或建议为主" },
];

export function classifyTask(text: string): Classification {
  const matches = rules.filter((rule) => rule.pattern.test(text));
  const categories = [...new Set(matches.map((match) => match.category))];
  if (categories.length > 1) {
    return {
      category: "mixed",
      confidence: "medium",
      reasons: matches.map((match) => match.reason),
      recommendedExecution: "split_task",
    };
  }
  const category = categories[0] ?? "advice";
  const recommendedExecution =
    category === "advice"
      ? "planner_only"
      : category === "analysis"
        ? "read_only"
        : category === "infrastructure" || category === "external_action"
          ? "human_gated"
          : "workspace_write";
  return {
    category,
    confidence: matches.length === 0 ? "low" : "high",
    reasons: matches.length === 0 ? ["未命中明确规则，默认由 Planner 澄清"] : matches.map((match) => match.reason),
    recommendedExecution,
  };
}
