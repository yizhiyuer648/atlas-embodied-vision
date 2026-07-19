import { CATEGORIES, loadModels, observeNumber, initReveals, escapeHTML } from '../core.js?v=20260719.8';

const ESSAYS = [
  {
    tag: '主线一 · VLA',
    title: '动作表示的三次跃迁：从「词」到「场」',
    signal: '信号：VLM 管语义、生成式动作头管控制,已成共识',
    paragraphs: [
      'VLA 的历史可以浓缩成「动作怎么表示」这一个问题的三次换代。第一代(RT-1、RT-2)把动作离散成 256 档的 token,塞进语言模型的词表——这个「动作即词」的技巧让互联网知识第一次流进了机器人控制,但代价是控制频率低、精细动作分辨率不足。第二代(OpenVLA)用更小的 7B 参数规模验证了这套配方可以被复现、比较和继续改造。',
      '第三代的共识是「解耦」:语言模型的离散词表天生不适合表达连续、多峰、50Hz 的机械臂轨迹,于是 Diffusion Policy 的生成式动作建模被接到 VLM 后面——CogACT 用扩散动作 Transformer 比同规模 OpenVLA 高出 35% 以上,π0 用流匹配把去噪迭代压到个位数,GR00T N1、DexVLA、RDT-1B 全部采用「VLM + 动作专家」的双模块架构。动作从「一个词」变成了「一个连续的场」。',
      '值得注意的反方向信号:Galaxea G0.5 等工作重新尝试把推理 token 与动作 token 统一进单个自回归解码器。解耦换来了控制质量,却切断了语义推理对动作的细粒度指导;统一与解耦的钟摆还会再摆几个来回。'
    ]
  },
  {
    tag: '主线二 · 世界模型',
    title: '预测像素还是预测特征：两条路线正在合流',
    signal: '信号:视频生成负责「可看」,特征预测负责「可用」',
    paragraphs: [
      '世界模型内部一直存在两条路线。生成派相信「能画出未来就是理解世界」:Sora 用时空 patch + DiT 把视频生成推到分钟级,Genie 从无标签视频学出可以「玩」的世界,Cosmos、Wan、混元则把视频生成推进到更完整的工程平台。它的优势是直观、可以直接当数据引擎和仿真器用;劣势是算力惊人,而且像素上的逼真不等于物理上的正确。',
      '表征派(Dreamer 系、JEPA 系)则认为预测应该发生在抽象空间:DreamerV3 用一套超参数在 150 个任务上通吃,靠的是只在潜空间想象;V-JEPA 拒绝重建像素,只预测被遮挡区域的特征,反而学出了更通用的视觉表征。这条路线便宜、稳定、适合控制,但产出「不可看」,难以直接变成产品。',
      '2025 年的关键变化是合流:V-JEPA 2 用 62 小时机器人视频后训练出动作条件世界模型,零样本部署到真机规划——特征世界模型第一次跑通了「看视频学操作」;而自动驾驶界(DriveDreamer、Vista、GAIA)早已把生成式世界模型当作长尾数据工厂在用。「预测未来」正在从论文概念变成基础设施。'
    ]
  },
  {
    tag: '主线三 · 目标检测',
    title: '十年检测史:每个「必需组件」都被证明可以删掉',
    signal: '信号:检测正在变成多模态大模型的一个接口',
    paragraphs: [
      '回看 2014 到 2024,目标检测的演进像一场持续的减法:R-CNN 时代的外部候选框算法被 RPN(可学习)取代;手工锚框被 FCOS、CenterNet 的 anchor-free 设计取代;ATSS 更是揭示了锚框之争的本质——决定性能的从来不是锚框,而是正负样本怎么分配;最后连 NMS 也被 DETR 的一对一匹配删掉了。每一轮减法都让检测器更接近「一个纯粹的端到端网络」。',
      '实时检测如今形成两条互相借鉴的路线:YOLO 家族靠工程生态和极限效率服务部署,RT-DETR 系证明 Transformer 也能进入实时档并免除 NMS;YOLOv10 的一致双分配又把一对多训练与一对一推理缝合在一起。读这一段历史时,比版本号更重要的是看清「样本分配、检测头与后处理」怎样共同决定速度和精度。',
      '更大的变局在类别体系之外:Grounding DINO 让检测器听懂任意文本描述,与 SAM 组合成「一句话找到并抠出任何东西」的流水线。当多模态大模型原生具备定位能力,「检测」作为独立任务的边界正在溶解——它正在变成大模型感知接口的一部分。'
    ]
  },
  {
    tag: '主线四 · 数据',
    title: '机器人领域真正的军备竞赛是数据,不是模型',
    signal: '信号:能把异构数据变成训练信号的技术都在增值',
    paragraphs: [
      '具身智能与语言模型最大的不同,是没有现成的「互联网」可爬。真机数据按小时计价:Open X-Embodiment 靠 21 家机构凑出百万级轨迹,π0 的能力来自 Physical Intelligence 自建的采集车间,AgiBot World 用百台机器人生产数据,NVIDIA GR00T 则设计了「真实-仿真-人类视频」三层数据金字塔。模型架构可以复现,数据采集与清洗管线却很难复制——这才是能力差异的重要来源。',
      '因此最有杠杆的技术,是那些能「点石成金」的数据转化器:UniVLA 从无动作标签的视频里学出潜动作,让人类视频也能训练机器人;RDT-1B 的统一动作空间让不同机器人的数据互相可用;GR-1/GR-2 证明纯视频预训练能大幅提升操作泛化。谁能吃下更杂的数据,谁的曲线就更陡。',
      '下一阶段的主题词是「闭环」:RoboCat 展示了模型自己生成数据、自己变强的雏形,RT-H 让人类的语言纠正变成廉价的训练信号。当部署中的机器人开始持续产出高质量数据,行业才算真正拿到飞轮。'
    ]
  },
  {
    tag: '主线五 · 系统融合',
    title: '世界模型与 VLA 正在从两端靠近',
    signal: '信号:预测未来开始直接服务动作选择与闭环规划',
    paragraphs: [
      '世界模型问「执行这个动作后会发生什么」,VLA 问「看见当前场景后该做什么」。过去它们常被分成生成与控制两个社区,现在边界正在消失:V-JEPA 2 把动作条件预测接到机器人规划,UniSim 用可交互视频生成模拟动作后果,而 VLA 也越来越常在输出动作前显式预测视觉变化。',
      '这次合流改变了规划方式。传统策略只为眼前动作打分,带世界模型的策略可以先在内部展开多个短未来,比较哪条轨迹更可能完成任务,再把第一步交给控制器。预测不必生成电影级画面;只要保留与碰撞、抓取和目标状态有关的信息,潜空间想象就可能足够。',
      '适合顺着读的顺序是 DreamerV3 → V-JEPA 2 → UniSim → 具备生成式动作头的 VLA。先理解「在内部想象」,再看「想象怎样受动作控制」,最后回到真实机器人的闭环执行,会比按发布时间逐篇追更更容易建立整体地图。'
    ]
  },
  {
    tag: '主线六 · 评估',
    title: '模型更强之前,先问它在哪个条件下更强',
    signal: '信号:成功率正在让位于跨场景、长时程与恢复能力',
    paragraphs: [
      '机器人论文里的一个成功率,通常只在特定本体、相机位置、任务集合和演示数量下成立。把 80% 与另一篇的 70% 直接比较,往往没有意义。更可靠的阅读方式是先对齐评估条件:是否见过相同物体,是否换过背景与指令,失败后能否恢复,以及一次任务到底需要多少连续步骤。',
      '新基准正在把注意力从短任务平均分移向三种更难的能力:跨本体迁移衡量同一个策略能否换机器人;长时程任务检验误差会不会逐步累积;扰动恢复则观察物体被移动、抓取滑落后模型能否重新规划。它们比单次演示更接近真实部署。',
      '学习时可以给每篇论文做一张四格卡片:训练数据、测试变化、评价指标、失败案例。看完一个新模型后,不要先问它排第几,而要问它比上游多跨过了哪一种变化。这样时间线就不再是名字列表,而会变成能力边界逐步外扩的地图。'
    ]
  }
];

export async function init() {
  const models = await loadModels();
  const knownYears = models.map(model => Number(model.year)).filter(Number.isFinite);
  const uniqueYears = new Set(knownYears);
  const latestYear = Math.max(...knownYears);
  const recentStart = latestYear - 2;
  const latest = models.filter(model => Number(model.year) === latestYear).length;
  const aTier = models.filter(model => model.tier === 'A').length;
  const metrics = [
    { value: models.length, suffix: '', label: '个代表模型' },
    { value: uniqueYears.size, suffix: '', label: '个有记录年份' },
    { value: latest, suffix: '', label: `${latestYear} 年收录发布` },
    { value: aTier, suffix: '', label: '个 A 级深度条目' }
  ];
  const metricRoot = document.getElementById('trend-metrics');
  metricRoot.innerHTML = metrics.map((metric, index) => `<article class="stat-item reveal-item" style="--delay:${index*80}ms"><strong>0</strong><p>${escapeHTML(metric.label)}</p></article>`).join('');
  metricRoot.querySelectorAll('strong').forEach((element,index) => observeNumber(element, metrics[index].value, { suffix: metrics[index].suffix, duration: 1100 }));

  const counts = new Map();
  for (let year = 2012; year <= 2026; year++) counts.set(year, models.filter(model => Number(model.year) === year).length);
  const categories = Object.entries(CATEGORIES).map(([key, meta]) => ({
    label: meta.short,
    color: meta.color,
    total: models.filter(model => model.category === key).length,
    recent: models.filter(model => model.category === key && Number(model.year) >= recentStart && Number(model.year) <= latestYear).length
  }));
  setupCanvas(document.getElementById('release-chart'), (ctx,w,h) => drawBars(ctx,w,h,counts));
  setupCanvas(document.getElementById('category-chart'), (ctx,w,h) => drawCategoryGrowth(ctx,w,h,categories));

  const essayRoot = document.getElementById('trend-essays');
  essayRoot.innerHTML = ESSAYS.map((essay, index) => `<article class="essay reveal-section" style="--delay:${(index % 2) * 60}ms">
    <div class="essay-side"><span class="essay-index">0${index + 1}</span><span class="essay-tag">${escapeHTML(essay.tag)}</span></div>
    <div class="essay-body">
      <h2>${escapeHTML(essay.title)}</h2>
      ${essay.paragraphs.map(paragraph => `<p>${escapeHTML(paragraph)}</p>`).join('')}
      <p class="essay-signal">${escapeHTML(essay.signal)}</p>
    </div>
  </article>`).join('');
  initReveals();
}

function setupCanvas(canvas, draw) {
  if (!canvas) return;
  const render = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,rect.width,rect.height);
    draw(ctx,rect.width,rect.height,dpr);
  };
  new ResizeObserver(render).observe(canvas); render();
}

function getNiceAxis(maxValue, intervals = 4) {
  const safeMax = Math.max(0, Number(maxValue) || 0);
  if (!safeMax) return { max: intervals, step: 1, intervals };

  const rawStep = safeMax / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = Math.max(1, Math.ceil(factor * magnitude));
  return { max: step * intervals, step, intervals };
}

function drawBars(ctx,w,h,counts) {
  const years = [...counts.keys()], values = [...counts.values()];
  const axis = getNiceAxis(Math.max(...values, 0)); const pad = { l: 38, r: 10, t: 18, b: 36 };
  const chartW = w-pad.l-pad.r, chartH = h-pad.t-pad.b;
  ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for(let i=0;i<=axis.intervals;i++) { const y=pad.t+chartH*i/axis.intervals; const tick=axis.max-axis.step*i; ctx.strokeStyle='rgba(58,50,36,.08)'; ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillStyle='#8b8778';ctx.fillText(String(tick),pad.l-8,y); }
  const slot=chartW/years.length, barW=Math.max(4,slot*.56); const gradient=ctx.createLinearGradient(0,pad.t,0,pad.t+chartH);gradient.addColorStop(0,'#e0906b');gradient.addColorStop(.5,'#c6613f');gradient.addColorStop(1,'rgba(198,97,63,.25)');
  years.forEach((year,index)=>{ const value=counts.get(year); const bh=value/axis.max*chartH; const x=pad.l+index*slot+(slot-barW)/2; const y=pad.t+chartH-bh; ctx.fillStyle=gradient; roundRect(ctx,x,y,barW,Math.max(2,bh),Math.min(4,barW/2));ctx.fill(); if(index%2===0||w>650){ctx.save();ctx.translate(x+barW/2,h-pad.b+14);ctx.rotate(-.55);ctx.fillStyle='#8b8778';ctx.textAlign='right';ctx.fillText(String(year),0,0);ctx.restore();}});
}

function drawCategoryGrowth(ctx,w,h,items) {
  const maxValue = Math.max(...items.map(item => item.total), 1);
  const labelWidth = w < 390 ? 54 : 66;
  const valueWidth = w < 390 ? 36 : 46;
  const pad = { l: labelWidth, r: valueWidth, t: 7, b: 8 };
  const chartW = Math.max(1, w - pad.l - pad.r);
  const rowH = (h - pad.t - pad.b) / items.length;
  const barH = Math.min(13, Math.max(9, rowH * .27));

  ctx.textBaseline = 'middle';
  items.forEach((item,index) => {
    const centerY = pad.t + rowH * (index + .5);
    const totalY = centerY - barH * .7;
    const recentY = centerY + barH * .7;
    const totalW = chartW * item.total / maxValue;
    const recentW = chartW * item.recent / maxValue;

    ctx.fillStyle = '#57544a';
    ctx.font = `${w < 390 ? 10 : 11}px system-ui`;
    ctx.textAlign = 'right';
    ctx.fillText(item.label, pad.l - 9, centerY);

    ctx.fillStyle = 'rgba(58,50,36,.07)';
    roundRect(ctx,pad.l,totalY-barH/2,chartW,barH,barH/2); ctx.fill();
    roundRect(ctx,pad.l,recentY-barH/2,chartW,barH,barH/2); ctx.fill();

    ctx.fillStyle = item.color;
    roundRect(ctx,pad.l,totalY-barH/2,Math.max(2,totalW),barH,barH/2); ctx.fill();
    if (item.recent) {
      ctx.globalAlpha = .42;
      roundRect(ctx,pad.l,recentY-barH/2,Math.max(2,recentW),barH,barH/2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = '#26251f';
    ctx.textAlign = 'left';
    ctx.font = '600 10px system-ui';
    ctx.fillText(`${item.total} / ${item.recent}`, pad.l + Math.min(totalW + 7, chartW - 1), centerY);
  });
}

function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
