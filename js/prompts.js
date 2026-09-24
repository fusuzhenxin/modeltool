/* 提示词库。分类数量由这里的条目决定，页面不另写死数字。 */
const PROMPT_CATS = [
  ["general", "通用能力"],
  ["reason", "推理能力"],
  ["code", "代码能力"],
  ["math", "数学能力"],
  ["doc", "文档理解"],
  ["vision", "多模态能力"],
  ["candy", "糖果测试"],
  ["html", "HTML作品"]
];
const PROMPT_DIFFS = [["", "全部"], ["easy", "简单"], ["medium", "中等"], ["hard", "困难"]];
const PROMPT_MODELS = [["", "全部"], ["general", "通用大模型"], ["code", "代码模型"], ["vision", "多模态模型"]];
const PROMPT_TAGS = ["Python", "代码", "推理", "图像", "总结", "问答", "数学", "逻辑", "多模态", "文档", "通用", "分析", "糖果", "HTML", "鹈鹕"];
const PROMPT_TONES = {
  general: ["#3b5ffa", "#eef2ff"],
  reason: ["#7c5cff", "#f3efff"],
  code: ["#1faf73", "#e7f8f0"],
  math: ["#e85d88", "#ffeff4"],
  doc: ["#14967f", "#e7f8f4"],
  vision: ["#e0922a", "#fff6e8"],
  candy: ["#e07a2f", "#fff4e8"],
  html: ["#3b5ffa", "#eef2ff"]
};

function promptIcon(category) {
  const paths = {
    general: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    reason: '<path d="M12 3.2a5.2 5.2 0 0 0-3.2 9.3c.5.4.8 1 .8 1.6h4.8c0-.6.3-1.2.8-1.6A5.2 5.2 0 0 0 12 3.2z"/><path d="M9.2 16.4h5.6M10 18.6h4"/>',
    code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
    math: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    vision: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.3"/><path d="m7 16 3.5-3 2 2 3-4 1.5 5"/>',
    candy: '<path d="M8 8.5h8v7H8z"/><path d="M4 12h4M16 12h4"/><path d="M12 8.5V6M12 15.5V18"/>',
    html: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M9 13l2 2-2 2M15 13l-2 2 2 2"/>'
  };
  return `<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[category] || ""}</svg>`;
}

const PROMPTS = [
  {
    id: "complex-instruction",
    title: "复杂指令理解测试",
    summary: "请分析以下多步骤指令，逐步拆解并给出执行方案，要求条理清晰、逻辑完整。",
    prompt: "请分析下面这条多步骤指令，先拆成可执行的小步，再给出执行方案。要求条理清晰、逻辑完整，并标出步骤之间的依赖。\n\n指令：下周五前准备一场 20 人的模型评测分享。预算 3000 元。需要场地、投影、两份讲义和一份签到表。讲义里要包含能力测试、迷惑题和绘图测试各一个例子。素食来宾 4 人。请列出时间顺序、负责事项和仍需确认的信息。",
    check: "应拆出步骤和依赖，并指出预算、饮食、材料里还没给定的信息。",
    category: "general", tags: ["通用能力", "理解", "多步骤"], difficulty: "medium", model: "general", featured: true
  },
  {
    id: "code-debug",
    title: "代码生成与调试测试",
    summary: "请根据需求编写一段 Python 代码，并指出可能的错误点和优化建议。",
    prompt: "请用 Python 写一个函数，读取一份模型回答记录（列表，每项含 model、score、ok），完成三件事：按 model 分组计算平均分、找出平均分低于 70 的模型、结果按平均分从高到低排序。然后指出这段实现里容易出错的点，并给一个更稳妥的写法。不要只给代码。",
    check: "应同时给出可运行思路、边界（空列表、缺字段）和优化建议。",
    category: "code", tags: ["代码能力", "Python", "调试"], difficulty: "medium", model: "code", featured: true
  },
  {
    id: "logic-analysis",
    title: "逻辑推理与分析",
    summary: "基于给定信息，进行多步推理，得出最终结论，并说明推理过程。",
    prompt: "根据以下信息做多步推理，给出最终结论，并写清每一步用了哪一条信息。信息不足就说明缺什么，不要补故事。\n\n1. 所有参加复测的模型都已经完成糖果测试。\n2. 完成糖果测试的模型里，只有得分不低于 85 的进入绘图复测。\n3. 模型甲参加了复测。\n4. 模型乙的糖果测试得分是 72。\n问：甲是否完成了糖果测试？乙能否进入绘图复测？",
    check: "甲可以推出已完成糖果测试；乙不能进入绘图复测。推理应引用原句。",
    category: "reason", tags: ["推理能力", "逻辑", "分析"], difficulty: "medium", model: "general", featured: true
  },
  {
    id: "image-describe",
    title: "图像理解与描述",
    summary: "请根据图片内容，生成详细的文字描述，包含场景、物体、颜色和情绪等信息。",
    prompt: "请根据图片写一段详细描述，覆盖场景、物体、颜色和画面情绪。当前这轮对话没有附上图片。请先明确说你看不到图片，不要编造画面细节。然后再根据我补充的文字做同一种描述练习：一张浅蓝色界面卡片，中间是一只骑自行车的鹈鹕，背景是淡淡的海面，整体安静、清楚。",
    check: "没有图片时应先承认看不到，再只描述补充文字里有的内容。",
    category: "vision", tags: ["多模态", "图像", "描述"], difficulty: "medium", model: "vision", featured: true
  },
  {
    id: "doc-qa",
    title: "文档总结与问答",
    summary: "阅读以下文档内容，提炼关键信息，并回答相关问题，要求简洁准确。",
    prompt: "阅读下面的说明，先用不超过 80 字概括，再回答问题。回答必须能在原文找到依据。\n\n说明：综合分只在基础、糖果、鹈鹕三项都有真实完成分时计算，权重分别是 0.4、0.35、0.25。缺任何一项时综合分留空，不记成 0。85 分及以上为正常，70 到 84 分为轻微异常，70 分以下为明显异常。密钥只保存在当前浏览器。\n\n问题：只做了糖果测试时，综合分是多少？70 分整属于哪一档？",
    check: "综合分应回答留空或未计算。70 分整属于轻微异常。",
    category: "doc", tags: ["文档理解", "总结", "问答"], difficulty: "medium", model: "general", featured: true
  },
  {
    id: "math-solve",
    title: "数学问题求解",
    summary: "请解答以下数学题目，并提供详细的解题步骤和思路，确保结果正确。",
    prompt: "请解这道题，写出关键步骤，不要只给最终数字。\n\n一次评测共 40 题。能力题占 40%，迷惑题占 35%，绘图结构分占 25%。某次原始正确率分别是能力 32/40、迷惑 20/40、绘图按百分制 75。若综合分按这三项百分制加权，结果是多少？请先把前两项换成百分制。",
    check: "能力 80、迷惑 50，综合分是 80×0.4 + 50×0.35 + 75×0.25 = 68.25。",
    category: "math", tags: ["数学能力", "数学", "计算", "推理"], difficulty: "medium", model: "general", featured: true
  },
  {
    id: "multi-turn",
    title: "多轮对话的连贯性测试",
    summary: "连续三轮追加约束，看模型会不会丢掉前面已经答应的条件。",
    prompt: "我们用一轮消息模拟多轮约束，请按顺序遵守，后文不取消前文。\n第一轮：用 4 句话介绍如何核对一个 API 返回。\n第二轮：每句不超过 20 个字。\n第三轮：不要出现“接口”二字，改用“上游”。\n请直接给出最终的 4 句。",
    check: "最终应是 4 句、每句不超过 20 字，且不出现“接口”。",
    category: "general", tags: ["通用", "多轮", "约束"], difficulty: "hard", model: "general", hot: 4, featured: true
  },
  {
    id: "role-constraint",
    title: "角色与边界",
    summary: "限定身份和不能做的事，看模型会不会出戏或偷偷加权限。",
    prompt: "你现在只是评测记录员。只能根据我给的分数做记录，不能改分数，也不能建议换模型。请把下面三条记成清单：能力 90，糖果未测，绘图 70。如果信息不够，写“未测”，不要估算综合分。",
    check: "不应算出综合分，也不应建议更换模型。",
    category: "general", tags: ["通用", "角色"], difficulty: "easy", model: "general"
  },
  {
    id: "format-json",
    title: "输出格式遵循",
    summary: "要求只输出指定 JSON，看模型会不会加解释或 Markdown。",
    prompt: "只输出一个 JSON 对象，不要使用 Markdown 代码块，不要附加解释。字段固定为 name、items、missing。name 为“格式测试”，items 是字符串数组 [\"能力\",\"糖果\"]，missing 为 true。",
    check: "整段应能被直接解析成 JSON，且没有前后说明。",
    category: "general", tags: ["通用", "格式"], difficulty: "medium", model: "general"
  },
  {
    id: "negation",
    title: "否定与例外",
    summary: "句子里同时有不要、除非和例外，看模型会不会看反。",
    prompt: "执行这条规则：不要列出具体模型商品名，除非我明确点名。这次我没有点名。请只说明评测时应比较同一套题目，不要举例到某个在售模型。如果做不到，就回答“无法按此限制完成”。",
    check: "不应借机罗列 GPT、Claude 等具体商品名。",
    category: "general", tags: ["通用", "否定"], difficulty: "hard", model: "general"
  },
  {
    id: "long-recap",
    title: "长文要点复述",
    summary: "读完一段后只保留被问到的要点，不把全文再讲一遍。",
    prompt: "下面是一段记录。请只回答两个要点：密钥存在哪里，综合分缺项时怎么显示。不要复述整段。\n\n记录：站点用同一套题比较模型。密钥加密后留在当前浏览器，报告里不写密钥。综合分需要基础、糖果、鹈鹕都有完成分。缺一项就留空。绘图测试看的是鹈鹕骑自行车，不是汽车问答。作品列表用静图封面。",
    check: "只应提到浏览器本地保存，以及缺项留空。",
    category: "general", tags: ["通用", "总结"], difficulty: "medium", model: "general"
  },
  {
    id: "priority-conflict",
    title: "指令优先级",
    summary: "两条要求冲突时，看模型是否按声明的优先级取舍。",
    prompt: "规则的优先级从高到低是：先保证事实，再保证简短，最后才考虑生动。请用一句话说明 70 分对应的降智档。如果“生动”会让你加进原文没有的比喻，就放弃生动。已知：85 及以上正常，70 到 84 轻微异常，70 以下明显异常。",
    check: "应说明 70 分属于轻微异常，且不添加比喻。",
    category: "general", tags: ["通用", "优先级"], difficulty: "hard", model: "general"
  },
  {
    id: "mixed-lang",
    title: "中英混排",
    summary: "中文问题里夹着英文术语，看模型会不会答非所问。",
    prompt: "用中文回答。术语可以保留英文。问题：为什么评测请求要经过本机的 start.bat，而不是让浏览器直接请求 OpenAI-compatible endpoint？请提到跨域这一原因，限制在两句以内。",
    check: "应用中文说明浏览器跨域，而不是改用英文长文。",
    category: "general", tags: ["通用", "理解"], difficulty: "easy", model: "general"
  },
  {
    id: "refusal-scope",
    title: "范围外的拒绝",
    summary: "题目要求保持在评测范围内，不把拒绝写成说教。",
    prompt: "你只回答与模型评测方法有关的问题。若问题无关，回复“这题不在评测范围内”，不要展开。问题：帮我写一条短信催同学还钱。",
    check: "应拒绝这道无关题，并且不写出催款短信。",
    category: "general", tags: ["通用", "边界"], difficulty: "medium", model: "general"
  },
  {
    id: "table-output",
    title: "表格输出",
    summary: "把三条规则收成指定列的表，不多加列。",
    prompt: "把下面三条收成 Markdown 表格，列只允许“项目”和“规则”。不要加第三列。\n基础：四项测验的平均。\n糖果：最近一次完成分。\n综合：三项齐全才计算。",
    check: "表格应只有两列、三行数据。",
    category: "general", tags: ["通用", "格式"], difficulty: "easy", model: "general"
  },
  {
    id: "audience",
    title: "受众切换",
    summary: "同一事实分别讲给使用者和讲给开发者，深度要不同。",
    prompt: "事实：页面通过 127.0.0.1:8766 打开，由本机转发请求。请先写给第一次使用的人，两句，不出现函数名。再写给改代码的人，两句，可以提到 serve.py。两段都不要互相重复整句。",
    check: "应分成两种说法，第一段没有代码标识符。",
    category: "general", tags: ["通用", "表达"], difficulty: "medium", model: "general"
  },
  {
    id: "step-order",
    title: "步骤依赖排序",
    summary: "给出乱序步骤，让模型排成能执行的顺序并说明为什么。",
    prompt: "下面的步骤被打乱了。请排成可以执行的顺序，并说明哪一步必须在另一项之前。不要增加新步骤。\nA. 在浏览器打开评测页\nB. 双击 start.bat\nC. 填写接口地址和密钥\nD. 开始一次能力测试\nE. 确认页面地址是 127.0.0.1:8766",
    check: "应先启动本机转发，再打开页面、核对地址、填写密钥，然后开始测试。",
    category: "general", tags: ["通用", "多步骤"], difficulty: "hard", model: "general"
  },
  {
    id: "causal",
    title: "逻辑推理与因果分析",
    summary: "区分“同时发生”和“因此发生”，没有证据就不要补因果。",
    prompt: "分析因果关系。只使用给定事实，分清相关和因果。\n事实：换了一家中转站之后，绘图测试开始经常超时；同一天办公室网络也做了维护；能力题的得分没有变化。\n问题：能不能得出“新中转站导致绘图超时”？还缺什么证据？",
    check: "不能仅凭同时发生下结论，应指出需要对照旧中转站或排除网络维护。",
    category: "reason", tags: ["推理", "分析", "因果"], difficulty: "hard", model: "general", hot: 2, featured: true
  },
  {
    id: "syllogism",
    title: "三段论是否有效",
    summary: "判断一组陈述能不能推出结论，无效就说明形式问题。",
    prompt: "判断这个推理是否有效，并说明原因。\n前提：有些降智模型的糖果分低于 70。模型甲糖果分低于 70。\n结论：模型甲是降智模型。",
    check: "推理无效。低于 70 不是降智的充分条件，原文只说“有些”。",
    category: "reason", tags: ["推理", "逻辑"], difficulty: "easy", model: "general"
  },
  {
    id: "necessary",
    title: "充分与必要",
    summary: "分清“才会”和“就会”，避免把必要条件当成充分条件。",
    prompt: "句子：只有三项都有完成分，才会显示综合分。模型乙三项都有完成分。能否推出乙一定显示了综合分？请说明这是必要还是充分。",
    check: "“只有…才…”给出的是必要条件。仅凭三项都有分，不能推出页面一定已经显示。",
    category: "reason", tags: ["推理", "逻辑"], difficulty: "medium", model: "general"
  },
  {
    id: "timeline",
    title: "时间线推理",
    summary: "按时间约束推出谁先谁后，矛盾要指出来。",
    prompt: "根据时间说明顺序。\n1. 密钥保存发生在第一次测试之前。\n2. 第一次测试完成于 10:20。\n3. 报告导出发生在第一次测试之后。\n4. 有人说密钥是在 10:30 才第一次保存的。\n哪一条和前面冲突？把能确定的顺序写出来。",
    check: "第 4 条与第 1、2 条冲突。导出在测试之后，测试在保存之后。",
    category: "reason", tags: ["推理", "时间"], difficulty: "hard", model: "general"
  },
  {
    id: "elimination",
    title: "排除法",
    summary: "四个选项里用给定条件逐个排除，留下最后一个时说明理由。",
    prompt: "用排除法回答，写清排除了谁。\n四条记录 A 能力、B 糖果、C 绘图、D 中转站。已知：进入综合分的不是中转站；绘图权重不是 0.4；能力权重大于糖果。权重只可能是 0.4、0.35、0.25 这三档，分别对应三项。问能力是哪一条记录、权重是多少？",
    check: "D 排除。能力权重 0.4，所以是 A。绘图不是 0.4，糖果是 0.35，绘图是 0.25。",
    category: "reason", tags: ["推理", "排除"], difficulty: "medium", model: "general"
  },
  {
    id: "analogy",
    title: "类比是否成立",
    summary: "判断一个类比哪里像、哪里不像，不要被句式带走。",
    prompt: "类比：中转站检测像给水管看有没有被人换过水表，能力测试像看水流本身清不清。这个类比哪里成立，哪里不成立？请各写一点，不要把类比当成证据。",
    check: "应承认两者都在分开“通道”和“内容”，同时指出水表类比不能证明掺水判定的具体规则。",
    category: "reason", tags: ["推理", "类比"], difficulty: "easy", model: "general"
  },
  {
    id: "correlation",
    title: "相关不是因果",
    summary: "两组成绩一起变高，不一定是同一个原因。",
    prompt: "观察：最近五次测试里，提示词写得越长，糖果分越高；同时题目也从困难改成了简单。请说明能不能把提分归因于提示词变长。",
    check: "不能。难度同时变了，长提示词和分数只是相关。",
    category: "reason", tags: ["推理", "分析"], difficulty: "hard", model: "general"
  },
  {
    id: "constraints",
    title: "多条件同时满足",
    summary: "在一组限制里找一个同时满足的安排，没有就说无解。",
    prompt: "找一个符合全部条件的安排。如果没有，回答无解并指出冲突的两条。\n条件：测试只能在周二或周四；周四场地关闭；糖果和绘图不能在同一天；绘图必须在周四；能力测试在绘图之前。",
    check: "无解。绘图必须在周四，但周四场地关闭。",
    category: "reason", tags: ["推理", "约束"], difficulty: "medium", model: "general"
  },
  {
    id: "counterfactual",
    title: "反事实",
    summary: "假设一条事实改变，只改受影响的结论。",
    prompt: "原来的结论是：缺鹈鹕分，所以综合分留空。现在假设鹈鹕分补上了 80，基础 90，糖果 70。综合分应怎么变？请重算，并说明哪一条旧结论不再成立。",
    check: "旧的“留空”不再成立。新综合分是 90×0.4 + 70×0.35 + 80×0.25 = 80.5。",
    category: "reason", tags: ["推理", "计算"], difficulty: "hard", model: "general"
  },
  {
    id: "code-practice",
    title: "生成代码的最佳实践",
    summary: "不只是能跑，还要看错误处理、命名和输入校验。",
    prompt: "请用 Python 写一个函数 normalize_score(value)。合法输入是 0 到 100 的数字或数字字符串，返回整数。空字符串、None、超过范围都要显式处理，不要静默改成 0。然后用四条断言说明你期望的行为。",
    check: "不应把非法输入偷偷变成 0。应包含范围校验和测试断言。",
    category: "code", tags: ["代码", "Python", "实践"], difficulty: "hard", model: "code", hot: 1, featured: true
  },
  {
    id: "bug-read",
    title: "读代码找缺陷",
    summary: "给一段有问题的代码，要求指出行为错误而不是只谈风格。",
    prompt: "阅读下面的函数，指出它在哪些输入上结果是错的。不要先重写。\n\ndef average(nums):\n    total = 0\n    for n in nums:\n        total += n\n    return total / len(nums)\n\n输入包括 []、[1, 2]、[None, 1]。",
    check: "空列表会除零，None 会在加法时报错。非空数字列表是对的。",
    category: "code", tags: ["代码", "调试"], difficulty: "medium", model: "code"
  },
  {
    id: "regex",
    title: "正则与反例",
    summary: "写一个模式后，必须自己给出应该匹配和不该匹配的例子。",
    prompt: "写一个正则，匹配本站这种页面文件名：小写字母开头，只含小写字母、数字和连字符，以 .html 结尾。请给出两个应匹配和两个不应匹配的例子，其中至少包含一个大写字母和一个 .. 路径。",
    check: "应拒绝大写和带 .. 的路径，而不是只丢一个表达式。",
    category: "code", tags: ["代码", "正则"], difficulty: "hard", model: "code"
  },
  {
    id: "sql",
    title: "查询条件",
    summary: "用 SQL 表达“三项都有分才进入统计”，避免把空值当成 0。",
    prompt: "表 runs(id, model, basic, candy, pelican)，分数列可能为 NULL。请写一条 SQL，列出可以计算综合分的模型，以及 basic*0.4 + candy*0.35 + pelican*0.25。不要用 COALESCE 把空分变成 0。",
    check: "WHERE 应要求三列都非空，且不把 NULL 换成 0。",
    category: "code", tags: ["代码", "SQL"], difficulty: "medium", model: "code"
  },
  {
    id: "complexity",
    title: "复杂度口述",
    summary: "看模型会不会对一段简单循环夸大复杂度。",
    prompt: "下面算法对一个长度为 n 的列表只遍历一次并累加。请给出时间复杂度和空间复杂度，并说明为什么不是 O(n log n)。不要改写代码。",
    check: "时间 O(n)，额外空间 O(1)。不应声称排序复杂度。",
    category: "code", tags: ["代码", "复杂度"], difficulty: "easy", model: "code"
  },
  {
    id: "unit-test",
    title: "测试用例设计",
    summary: "先写测试再写实现，用例要覆盖空值和边界。",
    prompt: "函数 band(score) 的约定：score 为 null 时返回“未检测”；大于等于 85 返回“正常”；70 到 84 返回“轻微异常”；低于 70 返回“明显异常”。请先列出至少 5 个测试用例，包含 70、85 和 null。先不要写实现。",
    check: "用例应包含 70、84、85、69 和 null，且 70 不是明显异常。",
    category: "code", tags: ["代码", "测试"], difficulty: "medium", model: "code"
  },
  {
    id: "refactor",
    title: "小步重构",
    summary: "只做指定的改动，不要顺手改行为。",
    prompt: "把重复的两段字符串拼接改成一个函数。要求：函数名用 join_reason，不改变原来的标点，不新增日志。请给出改后的函数，以及你故意没有改动的一点。",
    check: "应限制改动范围，并明确有什么保持原样。",
    category: "code", tags: ["代码", "重构"], difficulty: "easy", model: "code"
  },
  {
    id: "math-steps",
    title: "数学问题的分步解答",
    summary: "分步写出比例、单位和最后的取整，避免跳步。",
    prompt: "请分步解答。一个题库有 80 题，抽 25% 做复测，其中 1/5 是绘图题。绘图题有多少道？如果每道绘图题 3 分钟，这部分要多久？最后用分钟和小时两种说法，小时保留一位小数。",
    check: "复测 20 题，绘图 4 题，12 分钟，也就是 0.2 小时。",
    category: "math", tags: ["数学", "步骤"], difficulty: "hard", model: "general", hot: 5, featured: true
  },
  {
    id: "units",
    title: "单位换算",
    summary: "题目混用分钟和秒，看模型会不会直接相加。",
    prompt: "一次请求用了 1.5 分钟，重试又用了 40 秒。总耗时是多少秒？不要把 1.5 和 40 直接相加。",
    check: "1.5 分钟是 90 秒，总和 130 秒。",
    category: "math", tags: ["数学", "单位"], difficulty: "easy", model: "general"
  },
  {
    id: "probability",
    title: "概率表述",
    summary: "独立事件要用乘法，并说明独立这一假设。",
    prompt: "假设两次测试相互独立，单次通过概率都是 0.5。两次都通过的概率是多少？如果不能假设独立，这个数还成立吗？",
    check: "独立时是 0.25。不能假设独立时，这个乘积不成立。",
    category: "math", tags: ["数学", "概率"], difficulty: "medium", model: "general"
  },
  {
    id: "sequence",
    title: "数列找规律要验证",
    summary: "给出前几项后，要求验证下一项，而不是只报一个数字。",
    prompt: "数列前四项是 2、3、5、9。请给出一个能生成这四项的规则，并据此写第五项。同时说明至少还有一种规则也能拟合前四项，所以不能把答案说成唯一。",
    check: "应承认规律不唯一。例如 2*1+1、2*2-1、2*2+1 并不统一，不能假装只有一个答案。",
    category: "math", tags: ["数学", "规律"], difficulty: "hard", model: "general"
  },
  {
    id: "geometry",
    title: "几何量",
    summary: "给边长求周长，不要把面积公式拿来用。",
    prompt: "一个长方形宽 4、长 9，单位都是厘米。求周长。请写公式。不要计算面积。",
    check: "周长是 2×(4+9)=26 厘米。",
    category: "math", tags: ["数学", "几何"], difficulty: "easy", model: "general"
  },
  {
    id: "contract",
    title: "条款抽取",
    summary: "从短文里抽出期限、金额和义务，没有写的字段留空。",
    prompt: "从下面句子抽出表格，列：期限、金额、义务、违约责任。原文没有的格子填“未写”。\n\n句子：乙方在 5 个工作日内交付评测说明，费用 2000 元，由甲方验收。",
    check: "期限 5 个工作日，金额 2000 元，义务是交付说明。违约责任应为未写。",
    category: "doc", tags: ["文档", "抽取"], difficulty: "hard", model: "general"
  },
  {
    id: "meeting",
    title: "会议纪要",
    summary: "把口头决定收成结论、负责人和未决问题。",
    prompt: "把这段话收成三行：决定、负责人、未决。\n\n“先把提示词库放进顶栏。谁写页面谁补 README 那一行。群二维码用现成的，别换群号。首页要不要再放入口，下周三再定。”",
    check: "决定是加入顶栏。负责人没有点名到具体的人，应写未指定或按“谁写页面”。未决是首页入口。",
    category: "doc", tags: ["文档", "总结"], difficulty: "easy", model: "general"
  },
  {
    id: "table-read",
    title: "表格解读",
    summary: "只根据表中数字回答，不把空单元格读成 0。",
    prompt: "表：模型甲 基础 90、糖果 80、鹈鹕空；模型乙 基础 70、糖果 70、鹈鹕 70。问谁可以算综合分，甲的鹈鹕是不是 0 分？",
    check: "只有乙三项齐全。甲的空单元格不是 0 分。",
    category: "doc", tags: ["文档", "表格"], difficulty: "medium", model: "general"
  },
  {
    id: "contradiction",
    title: "找出矛盾句",
    summary: "两句不能同时为真时，指出来，不要帮原文圆场。",
    prompt: "下面两句是否矛盾？请指出不能同时成立的地方。\n甲：缺任何一项时综合分留空。\n乙：缺鹈鹕分时，综合分按另外两项折算后仍然显示。",
    check: "两句矛盾。乙在缺项时仍显示分数，与甲冲突。",
    category: "doc", tags: ["文档", "矛盾"], difficulty: "hard", model: "general"
  },
  {
    id: "image-scene",
    title: "图像描述与场景理解",
    summary: "没有图时不要假装看见，有文字场景时只描述给定元素。",
    prompt: "任务是描述场景里的主体、位置和光线。这轮没有图片。请先说明看不到图。然后只根据这段文字描述：夜间的码头，左侧一盏暖色灯，右侧一艘深色船，前景没有人。不要添加天气和声音，原文没写。",
    check: "应拒绝假装看图，并且不添加原文没有的雨、风或人物。",
    category: "vision", tags: ["图像", "多模态", "场景"], difficulty: "hard", model: "vision", hot: 3, featured: true
  },
  {
    id: "chart",
    title: "图表读取",
    summary: "用文字转写一张简单柱状图，不把相邻柱子读反。",
    prompt: "没有图片。请先说明你看不到图表。然后根据这个文字版柱状图读数：正常 12、轻微 7、明显 3。问哪一档最多，三档合计多少。不要把柱高想象成别的数字。",
    check: "正常最多，合计 22。应先承认没有看到图。",
    category: "vision", tags: ["图像", "图表"], difficulty: "medium", model: "vision"
  },
  {
    id: "ui-text",
    title: "界面文字识别",
    summary: "辨认按钮文字时，不把旁边的说明算进按钮。",
    prompt: "没有截图。请先说明看不到界面。然后根据这段界面文字回答：顶栏按钮分别是“QQ群”“GitHub”“接口设置”。问主按钮有几个，名称是什么？不要把页面标题算成按钮。",
    check: "应回答三个按钮，名称与原文一致，且不把标题算进去。",
    category: "vision", tags: ["多模态", "界面"], difficulty: "easy", model: "vision"
  }
];

const CANDY_TITLES = {
  "candy-bag": "糖袋里至少取多少",
  "candy-pen": "笔和笔记本的价钱",
  "candy-lily": "睡莲哪天铺满一半",
  "candy-machine": "机器生产零件要多久",
  "candy-sheep": "三种颜色的羊",
  "candy-speed": "往返的平均时速",
  "candy-class": "两个兴趣组都参加",
  "candy-price": "涨价再降价后的现价",
  "candy-snail": "蜗牛第几天出井",
  "candy-photo": "照片里的人是谁",
  "candy-surgeon": "主刀医生是谁",
  "candy-moses": "谁建造了方舟",
  "candy-socks": "保证一双同色袜子",
  "candy-square": "0.9 的平方",
  "candy-clock": "时针和分针何时重合",
  "candy-rope": "不均匀的绳子烧 45 分钟",
  "candy-monty": "三扇门要不要换",
  "candy-soda": "空瓶能换几瓶汽水",
  "candy-knight": "骑士和无赖",
  "candy-halfprice": "书价是一半再加一元",
  "candy-daughters": "第五个女儿叫什么",
  "candy-months": "几个月至少有 28 天",
  "candy-survivors": "幸存者该埋在哪",
  "candy-rooster": "公鸡下的蛋往哪滚",
  "candy-divide": "除以二分之一再加十",
  "candy-coins": "哪一枚不是五分硬币",
  "candy-nines": "1 到 100 有几个 9",
  "candy-strike": "钟敲十二下要几秒",
  "candy-left": "牧场还剩几只羊",
  "candy-peak": "测量前最高的山"
};
const HTML_WORKS = [
  ["qq-speed", "QQ飞车", "做一个可玩的网页竞速：能漂移、使用氮气，并有四条赛道。车辆和音效用代码生成，不要外链游戏素材。页面上标明这是同人演示，不是腾讯官方游戏。", ["3D", "竞速"], "同人演示，不是腾讯官方游戏。"],
  ["cf-ship", "穿越火线之运输船", "做一个运输船甲板的网页射击：有集装箱、可操作的枪械和电脑对手。这是同人演示，不要写成腾讯官方游戏。", ["3D", "射击"], "同人演示，不是腾讯官方游戏。"],
  ["pelican-bike-opus", "海岸上的鹈鹕骑车", "做一个海岸骑行的 3D 页面：鹈鹕戴头盔、围红围巾，骑着自行车，画面里有海浪、昼夜变化，并且能抓鱼。不要用外部贴图。", ["3D", "鹈鹕"], ""],
  ["red-cliffs", "赤壁之战", "用 Three.js 做一个单文件页面，用时间轴分幕呈现赤壁战场。镜头能在各幕之间切换。", ["3D"], ""],
  ["storm-race", "风暴竞速", "做一个浏览器里的 3D 竞速，打开就能开一局，赛道和车辆由页面自己画出来。", ["3D", "竞速"], ""],
  ["junk-run", "废土跑酷", "做一个废土风格的网页跑酷，角色向前跑并躲避障碍，单个 HTML 里完成。", ["3D", "跑酷"], ""],
  ["harbor-skirmish", "港口交火", "用 Three.js 做一个海战小页面：水面、船只和可以开火的简单战斗。", ["3D", "射击"], ""],
  ["westward", "西进之路", "做一个在浏览器里向西前进的 3D 旅途页面，能沿路线移动并看到沿途地标。", ["3D"], ""],
  ["sulli-run", "赛博跑酷", "把一张平面的赛博朋克画面做成可以跑动的 3D 跑酷，单文件 HTML。", ["3D", "跑酷"], ""],
  ["magic-carpet", "飞毯", "用 Three.js 做一块可以操纵的飞毯，在空中飞过简单的地形。", ["3D"], ""],
  ["shells-3d", "街区射击", "做一个俯视或跟随视角的街区射击小游戏，能移动和射击，资源放在同一个 HTML 里。", ["3D", "射击"], ""],
  ["top-tennis", "网球对打", "做一个浏览器里的 3D 网球，能发球和对打，场地和球拍用代码画出。", ["3D"], ""],
  ["duck-off", "橡皮鸭竞速", "做一局橡皮鸭划水竞速，多只鸭子同时前进，玩家控制其中一只。", ["3D", "竞速"], ""],
  ["settlecoast", "海岛经营", "做一个能在海岛上经营的小页面：可以放置建筑，并看到资源变化。", ["3D"], ""],
  ["last-light", "最后的光", "做一个有明确关卡目标的网页故事场景，能移动并触发下一幕。", ["3D"], ""],
  ["wonderforge", "奇迹工地", "做一个文明风格的建造动画页，能选择一座建筑并看到它逐段出现。", ["3D"], ""],
  ["red-flag", "限速计时", "做一个日本一般道路风格的限速计时赛，单个 HTML，显示速度和剩余时间。", ["3D", "竞速"], ""],
  ["starship-foundry", "等距造船", "做一个等距视角的造船页面：先组装飞船，再让它飞出去。用 Three.js，单个 HTML。", ["3D"], ""],
  ["pacman-sharks", "鲨鱼吃豆", "做一个吃豆人式的网页小游戏，迷宫、豆子和追逐的对手都在这一页里。", ["互动"], ""],
  ["pvz-web", "草坪塔防", "做一个草坪上的塔防小页面：能放置单位，敌人从一侧进来。标明不是官方客户端。", ["互动", "塔防"], "这是同人页面，不是官方游戏客户端。"],
  ["hyperbrick", "霓虹打砖块", "写一个单文件打砖块：球、挡板和砖块用这一页里的样式和脚本完成。", ["互动"], ""],
  ["chess-study", "国际象棋练习", "做一个单文件国际象棋练习页，能摆棋、走子，并提示这一步是否合法。", ["互动"], ""],
  ["strandbeest", "风力步行机械", "做一个风力步行机械的模拟页，腿部连杆会随风或随滑块运动。", ["互动"], ""],
  ["soft-machine", "浏览器合成器", "做一个可以弹的合成器，声音在浏览器里现算，不加载外部音频文件。", ["互动", "音乐"], ""],
  ["pocket-city", "等距小城", "做一个等距小城，可以摆房子，并有简单的昼夜变化。", ["互动"], ""],
  ["luminote", "下落音符", "做一个音符下落的钢琴页，按下对应键可以打中音符。", ["互动", "音乐"], ""],
  ["brandenburg-piano", "网页钢琴", "做一个可以弹的网页钢琴，键盘能点，并奏出不同音高。", ["互动", "音乐"], ""],
  ["navier-stokes", "方程讲解页", "做一个可以翻页的科普页，用图示讲一个流体方程，公式和说明都在这一页里。", ["互动", "科普"], ""],
  ["timber-atlas", "古建木构拆解", "用三维拆开一座中国古建的木构，能逐层显示梁、柱和斗拱。", ["3D"], ""],
  ["dust-front", "即时战略一角", "做一个浏览器里的即时战略片段：能选中单位并下移动命令。", ["3D", "策略"], ""],
  ["astra-globe", "物流地球", "用 Three.js 做一个地球仪表盘，球上有航线和简单的数据标注。", ["3D"], ""],
  ["pelican-zoo", "鹈鹕作品廊", "做一个画廊页，列出多幅鹈鹕骑车的图，点开能看大图。图可以用内联 SVG。", ["互动", "鹈鹕"], ""],
  ["claude-100-html", "一百个单文件页面", "做一个画廊首页，里面是多张单文件小作品的入口，每张卡片能打开一个独立演示。", ["互动"], ""],
  ["astra-100-html", "一百个视觉练习", "做一个可以翻看的画廊，每件都是单文件视觉练习，点进去能单独打开。", ["互动"], ""],
  ["fable-100-html", "一百页任务画廊", "做一个任务式画廊：一页里列出一百个单文件页面的入口，并说明每件都能单独打开。", ["互动"], ""],
  ["tihuqiche", "可玩的鹈鹕骑车", "用 Three.js 做一个能玩的鹈鹕骑车：鹈鹕骑在自行车上，有一条可以前进的赛道。单个 HTML。", ["3D", "鹈鹕"], "公开的可玩版本是憧憬 Licoy 的 MIT 作品。这里是按同样题材写的生成要求。"]
];

(DATA.bank || []).filter((item) => item.kind === "candy").forEach((item) => {
  const letters = "ABCD";
  const lines = item.options.map((opt, index) => letters[index] + ". " + opt).join("\n");
  const body = "题目：\n" + item.stem + "\n选项：\n" + lines + "\n\n只回复一个大写字母（A、B、C 或 D）。";
  PROMPTS.push({
    id: item.id,
    title: CANDY_TITLES[item.id] || item.stem.slice(0, 18),
    summary: item.stem,
    prompt: body,
    user: body,
    system: "你在做单项选择题。只输出一个大写字母 A、B、C 或 D，不要输出解释。",
    check: "答案是 " + letters[item.answer] + "。" + item.explain,
    category: "candy",
    tags: ["糖果", "迷惑题"],
    difficulty: item.difficulty,
    model: "general",
    featured: !!item.pin,
    href: "candy.html"
  });
});

(DATA.pelicanModes || []).forEach((mode) => {
  PROMPTS.push({
    id: "html-" + mode.id,
    title: mode.name + " · 鹈鹕骑车",
    summary: mode.prompt,
    prompt: mode.system + "\n\n" + mode.prompt,
    user: mode.prompt,
    system: mode.system,
    check: "页面是完整 HTML。鹈鹕要能看出长嘴和喉囊，自行车要有两个轮子和车架，鹈鹕骑在车上。作品列表里的静态 SVG 和 2D 动画用的是同一类要求。",
    category: "html",
    tags: ["HTML", "鹈鹕", mode.short],
    difficulty: mode.id === "svg" ? "medium" : "hard",
    model: "code",
    featured: true,
    href: "pelican.html"
  });
});

HTML_WORKS.forEach((row) => {
  const ask = "只输出一个完整的 HTML 文件，不要解释，不要使用 Markdown。\n\n" + row[2] + "\n\n页面要能直接在浏览器打开。不要写测试代码。";
  PROMPTS.push({
    id: "html-" + row[0],
    title: row[1],
    summary: row[2],
    prompt: ask,
    user: row[2],
    system: "你只输出一个完整的 HTML 文件，不要解释，不要使用 Markdown。",
    check: "这是按公开作品整理的生成要求，用来自己试写一页。" + (row[4] ? row[4] : "可以打开作品页对照画面。"),
    category: "html",
    tags: ["HTML"].concat(row[3]),
    difficulty: "hard",
    model: "code",
    href: "work.html?id=" + row[0]
  });
});
