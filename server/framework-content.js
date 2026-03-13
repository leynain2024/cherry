import { randomUUID } from 'node:crypto'

const createRewardRule = (unlockAtStars) => ({
  starsPerComplete: 2,
  starsPerPerfect: 3,
  unlockAtStars,
  reviewTriggerMistakes: 2,
})

const createUnit = ({
  subjectId,
  order,
  title,
  stage,
  goal,
  emoji,
  color,
  vocabulary,
  patterns,
  reading,
  activities,
}) => ({
  id: `framework-${subjectId}-${order}`,
  subjectId,
  title,
  source: '海宝体验课框架',
  stage,
  goal,
  difficulty: order <= 2 ? 'Starter' : order <= 4 ? 'Bridge' : 'Explorer',
  unlockOrder: order,
  coverEmoji: emoji,
  themeColor: color,
  status: 'published',
  contentOrigin: 'framework',
  sourceImageIds: [],
  rewardRule: createRewardRule(order * 8),
  vocabulary,
  patterns,
  reading,
  activities,
})

const warmup = (unitKey, title, prompt, cards) => ({
  id: `${unitKey}-warmup`,
  title,
  prompt,
  skill: 'read',
  kind: 'warmup',
  durationMinutes: 2,
  cards,
})

const listenChoice = (unitKey, title, prompt, audioText, question, options, correctOptionId) => ({
  id: `${unitKey}-listen`,
  title,
  prompt,
  skill: 'listen',
  kind: 'listen-choice',
  durationMinutes: 2,
  audioText,
  question,
  options,
  correctOptionId,
})

const speakRepeat = (unitKey, title, prompt, transcript, hint, encouragement) => ({
  id: `${unitKey}-speak`,
  title,
  prompt,
  skill: 'speak',
  kind: 'speak-repeat',
  durationMinutes: 2,
  transcript,
  hint,
  encouragement,
})

const readChoice = (unitKey, title, prompt, passage, question, options, correctOptionId) => ({
  id: `${unitKey}-read`,
  title,
  prompt,
  skill: 'read',
  kind: 'read-choice',
  durationMinutes: 3,
  passage,
  question,
  options,
  correctOptionId,
})

const writeSpell = (unitKey, title, prompt, sentence, answer, tips) => ({
  id: `${unitKey}-write`,
  title,
  prompt,
  skill: 'write',
  kind: 'write-spell',
  durationMinutes: 2,
  sentence,
  answer,
  tips,
})

const challenge = (unitKey, title, prompt, questions, reviewIds) => ({
  id: `${unitKey}-challenge`,
  title,
  prompt,
  skill: 'write',
  kind: 'challenge',
  durationMinutes: 3,
  questions,
  reviewIds,
})

export const defaultSubject = {
  id: 'subject-haibao-experience',
  name: '海宝体验课',
  description: '面向小学中高年级的英语体验课，先提供对齐教材范围的原创框架单元。',
  themeColor: '#48a8f6',
  status: 'active',
  createdAt: new Date().toISOString(),
}

export const buildFrameworkUnits = (subjectId = defaultSubject.id) => {
  const helloVocab = [
    { id: randomUUID(), word: 'hello', phonetic: '/həˈləʊ/', meaning: '你好', imageLabel: '挥手问好', example: 'Hello, I am Amy.' },
    { id: randomUUID(), word: 'name', phonetic: '/neɪm/', meaning: '名字', imageLabel: '名字卡', example: 'My name is Ben.' },
    { id: randomUUID(), word: 'boy', phonetic: '/bɔɪ/', meaning: '男孩', imageLabel: '笑着的男孩', example: 'He is a boy.' },
    { id: randomUUID(), word: 'girl', phonetic: '/ɡɜːl/', meaning: '女孩', imageLabel: '举手的女孩', example: 'She is a girl.' },
  ]

  const familyVocab = [
    { id: randomUUID(), word: 'mother', phonetic: '/ˈmʌðə/', meaning: '妈妈', imageLabel: '微笑的妈妈', example: 'This is my mother.' },
    { id: randomUUID(), word: 'father', phonetic: '/ˈfɑːðə/', meaning: '爸爸', imageLabel: '戴眼镜的爸爸', example: 'This is my father.' },
    { id: randomUUID(), word: 'sister', phonetic: '/ˈsɪstə/', meaning: '姐姐/妹妹', imageLabel: '扎辫子的女孩', example: 'She is my sister.' },
    { id: randomUUID(), word: 'family', phonetic: '/ˈfæməli/', meaning: '家庭', imageLabel: '一家人合照', example: 'I love my family.' },
  ]

  const classroomVocab = [
    { id: randomUUID(), word: 'book', phonetic: '/bʊk/', meaning: '书', imageLabel: '蓝色课本', example: 'It is a book.' },
    { id: randomUUID(), word: 'bag', phonetic: '/bæɡ/', meaning: '书包', imageLabel: '红色书包', example: 'This is my bag.' },
    { id: randomUUID(), word: 'pen', phonetic: '/pen/', meaning: '钢笔', imageLabel: '黑色钢笔', example: 'It is a pen.' },
    { id: randomUUID(), word: 'desk', phonetic: '/desk/', meaning: '课桌', imageLabel: '教室桌子', example: 'The pen is on the desk.' },
  ]

  const colorVocab = [
    { id: randomUUID(), word: 'red', phonetic: '/red/', meaning: '红色', imageLabel: '红色气球', example: 'It is red.' },
    { id: randomUUID(), word: 'blue', phonetic: '/bluː/', meaning: '蓝色', imageLabel: '蓝色书包', example: 'My bag is blue.' },
    { id: randomUUID(), word: 'green', phonetic: '/ɡriːn/', meaning: '绿色', imageLabel: '绿色树叶', example: 'The leaf is green.' },
    { id: randomUUID(), word: 'yellow', phonetic: '/ˈjeləʊ/', meaning: '黄色', imageLabel: '黄色太阳', example: 'It is yellow.' },
  ]

  const numberVocab = [
    { id: randomUUID(), word: 'one', phonetic: '/wʌn/', meaning: '一', imageLabel: '一只气球', example: 'One red balloon.' },
    { id: randomUUID(), word: 'two', phonetic: '/tuː/', meaning: '二', imageLabel: '两支铅笔', example: 'Two pencils.' },
    { id: randomUUID(), word: 'three', phonetic: '/θriː/', meaning: '三', imageLabel: '三只小鸭', example: 'Three ducks.' },
    { id: randomUUID(), word: 'toy', phonetic: '/tɔɪ/', meaning: '玩具', imageLabel: '毛绒玩具', example: 'This is my toy.' },
  ]

  const actionVocab = [
    { id: randomUUID(), word: 'sit', phonetic: '/sɪt/', meaning: '坐下', imageLabel: '坐着的小朋友', example: 'Sit down, please.' },
    { id: randomUUID(), word: 'stand', phonetic: '/stænd/', meaning: '站立', imageLabel: '站着的小朋友', example: 'Stand up, please.' },
    { id: randomUUID(), word: 'open', phonetic: '/ˈəʊpən/', meaning: '打开', imageLabel: '打开书本', example: 'Open your book.' },
    { id: randomUUID(), word: 'close', phonetic: '/kləʊz/', meaning: '关闭', imageLabel: '合上书本', example: 'Close your book.' },
  ]

  return [
    createUnit({
      subjectId,
      order: 1,
      title: 'Unit 1 · Hello Again',
      stage: '阶段一 · 问候与自我介绍',
      goal: '会用简单问候和自我介绍完成第一次见面交流。',
      emoji: '🌤️',
      color: '#48a8f6',
      vocabulary: helloVocab,
      patterns: [
        { id: randomUUID(), sentence: 'My name is ___.', slots: ['Amy', 'Ben', 'Lucy'], demoLine: 'My name is Lucy.' },
        { id: randomUUID(), sentence: 'What is your name?', slots: ['your'], demoLine: 'What is your name?' },
      ],
      reading: {
        id: randomUUID(),
        title: 'At the classroom door',
        content: 'Teacher: Hello! Boy: Hello! Teacher: What is your name? Boy: My name is Ben.',
        audioText: 'Hello. What is your name? My name is Ben.',
        question: 'Who is Ben?',
      },
      activities: [
        warmup('u1', '热身词卡', '先看看图片，把今天要用到的核心词读熟。', helloVocab),
        listenChoice('u1', '听音选意思', '听老师说一句，选出正确意思。', 'Hello! My name is Amy.', '这句话表示什么？', [
          { id: 'a', label: '你好，我叫 Amy。', emoji: '👋' },
          { id: 'b', label: '这是我的书包。', emoji: '🎒' },
          { id: 'c', label: '她是我的老师。', emoji: '👩‍🏫' },
        ], 'a'),
        speakRepeat('u1', '跟读小明星', '听示范，再完整跟读一句。', 'Hello! My name is Amy.', '先模仿停顿，再模仿语气。', ['发音清楚', '语调自然', 'name 的重读还可以更明显']),
        readChoice('u1', '读对话找答案', '读一读这个小对话。', 'Teacher: Hello! Girl: Hello! Teacher: What is your name? Girl: My name is Lucy.', 'Lucy 是谁？', [
          { id: 'a', label: '一个女孩', emoji: '👧' },
          { id: 'b', label: '一个老师', emoji: '👩‍🏫' },
          { id: 'c', label: '一本书', emoji: '📘' },
        ], 'a'),
        writeSpell('u1', '拼写补全', '补出句子里的核心词。', 'My ____ is Amy.', 'name', ['这一句是在介绍名字。', '答案有 4 个字母。']),
        challenge('u1', '单元挑战', '把问候和自我介绍串起来完成挑战。', [
          { id: randomUUID(), prompt: 'Which sentence asks a name?', options: [{ id: 'a', label: 'What is your name?' }, { id: 'b', label: 'This is my bag.' }, { id: 'c', label: 'Open your book.' }], correctOptionId: 'a' },
          { id: randomUUID(), prompt: '“你好，我叫 Ben。”对应哪句？', options: [{ id: 'a', label: 'Hello! My name is Ben.' }, { id: 'b', label: 'Ben is my bag.' }, { id: 'c', label: 'This is Ben book.' }], correctOptionId: 'a' },
        ], ['u1-listen', 'u1-read', 'u1-write']),
      ],
    }),
    createUnit({
      subjectId,
      order: 2,
      title: 'Unit 2 · My Family',
      stage: '阶段一 · 家庭成员',
      goal: '会介绍家人并听懂基础家庭关系表达。',
      emoji: '🏡',
      color: '#6eb8ff',
      vocabulary: familyVocab,
      patterns: [
        { id: randomUUID(), sentence: 'This is my ___.', slots: ['mother', 'father', 'sister'], demoLine: 'This is my mother.' },
        { id: randomUUID(), sentence: 'Who is she?', slots: ['she'], demoLine: 'Who is she? She is my sister.' },
      ],
      reading: {
        id: randomUUID(),
        title: 'A family photo',
        content: 'Boy: Look! This is my family. Girl: Who is she? Boy: She is my mother.',
        audioText: 'Look! This is my family. Who is she? She is my mother.',
        question: 'Who is she?',
      },
      activities: [
        warmup('u2', '家庭词汇卡', '观察图片，把家人词汇认熟。', familyVocab),
        listenChoice('u2', '听音找家人', '听句子，选出正确意思。', 'This is my father.', '老师说的是哪句话？', [
          { id: 'a', label: '这是我的爸爸。', emoji: '👨' },
          { id: 'b', label: '这是我的妹妹。', emoji: '👧' },
          { id: 'c', label: '这是我的书。', emoji: '📗' },
        ], 'a'),
        speakRepeat('u2', '介绍我的家人', '看图完整跟读家人介绍。', 'This is my mother.', '注意 mother 的 th 发音。', ['句子完整', '声音稳定', 'mother 的发音再清楚一点']),
        readChoice('u2', '读图说关系', '读一读小对话。', 'Girl: Who is she? Boy: She is my sister. Girl: She is nice.', '对话中的 she 是谁？', [
          { id: 'a', label: 'boy 的 sister', emoji: '👧' },
          { id: 'b', label: 'boy 的 teacher', emoji: '👩‍🏫' },
          { id: 'c', label: 'boy 的 bag', emoji: '🎒' },
        ], 'a'),
        writeSpell('u2', '看图写词', '补全家庭单词。', 'I love my ______.', 'family', ['表示“家庭、家人”。', '答案有 6 个字母。']),
        challenge('u2', '照片挑战赛', '完成家庭介绍挑战。', [
          { id: randomUUID(), prompt: 'Which sentence means “这是我的妈妈”？', options: [{ id: 'a', label: 'This is my mother.' }, { id: 'b', label: 'Who is she?' }, { id: 'c', label: 'It is a book.' }], correctOptionId: 'a' },
          { id: randomUUID(), prompt: '“Who is she?” 最合适的回答是？', options: [{ id: 'a', label: 'She is my sister.' }, { id: 'b', label: 'My name is Tom.' }, { id: 'c', label: 'Open your book.' }], correctOptionId: 'a' },
        ], ['u2-listen', 'u2-read', 'u2-write']),
      ],
    }),
    createUnit({
      subjectId,
      order: 3,
      title: 'Unit 3 · In the Classroom',
      stage: '阶段一 · 教室物品',
      goal: '会用简单问答识别并介绍常见教室物品。',
      emoji: '🎒',
      color: '#74c7ff',
      vocabulary: classroomVocab,
      patterns: [
        { id: randomUUID(), sentence: 'What is this?', slots: ['this'], demoLine: 'What is this? It is a book.' },
        { id: randomUUID(), sentence: 'It is a ___.', slots: ['book', 'bag', 'pen'], demoLine: 'It is a pen.' },
      ],
      reading: {
        id: randomUUID(),
        title: 'In the schoolbag',
        content: 'Teacher: What is this? Girl: It is a bag. Teacher: Is the pen in the bag? Girl: Yes!',
        audioText: 'What is this? It is a bag. Is the pen in the bag? Yes.',
        question: 'What is this?',
      },
      activities: [
        warmup('u3', '物品观察站', '先认识四个教室物品。', classroomVocab),
        listenChoice('u3', '听音选物品', '听老师说的物品名称。', 'It is a book.', '老师说的是哪样东西？', [
          { id: 'a', label: 'book', emoji: '📘' },
          { id: 'b', label: 'bag', emoji: '🎒' },
          { id: 'c', label: 'desk', emoji: '🪑' },
        ], 'a'),
        speakRepeat('u3', '课堂问答秀', '先听，再把问答一起读出来。', 'What is this? It is a pen.', '先问，再答，句子连起来读。', ['问答都读出来了', '节奏不错', 'pen 的尾音还能更完整']),
        readChoice('u3', '阅读找答案', '读短对话回答问题。', 'Teacher: What is this? Boy: It is a book. Teacher: Is the book on the desk? Boy: Yes, it is.', 'What is this?', [
          { id: 'a', label: 'A book', emoji: '📘' },
          { id: 'b', label: 'A bag', emoji: '🎒' },
          { id: 'c', label: 'A desk', emoji: '🪑' },
        ], 'a'),
        writeSpell('u3', '拼写工坊', '补全正确的物品单词。', 'It is a ____.', 'book', ['是一件可以阅读的东西。', '答案有 4 个字母。']),
        challenge('u3', '教室寻宝挑战', '把听力、问答和拼写串起来。', [
          { id: randomUUID(), prompt: 'What is this? 的正确回答是？', options: [{ id: 'a', label: 'It is a pen.' }, { id: 'b', label: 'My name is Ben.' }, { id: 'c', label: 'She is my mother.' }], correctOptionId: 'a' },
          { id: randomUUID(), prompt: '哪一个单词表示“书包”？', options: [{ id: 'a', label: 'bag' }, { id: 'b', label: 'book' }, { id: 'c', label: 'desk' }], correctOptionId: 'a' },
        ], ['u3-listen', 'u3-read', 'u3-write']),
      ],
    }),
    createUnit({
      subjectId,
      order: 4,
      title: 'Unit 4 · Colors Around Me',
      stage: '阶段一 · 基础颜色',
      goal: '能听懂并表达常见颜色，并把颜色和物品连接起来。',
      emoji: '🎨',
      color: '#85d4ff',
      vocabulary: colorVocab,
      patterns: [
        { id: randomUUID(), sentence: 'It is ___.', slots: ['red', 'blue', 'green'], demoLine: 'It is blue.' },
        { id: randomUUID(), sentence: 'My ___ is ___.', slots: ['bag', 'book', 'pen'], demoLine: 'My bag is red.' },
      ],
      reading: {
        id: randomUUID(),
        title: 'My colorful bag',
        content: 'Girl: My bag is blue. Boy: My pen is red. Teacher: Great colors!',
        audioText: 'My bag is blue. My pen is red.',
        question: 'What color is the bag?',
      },
      activities: [
        warmup('u4', '颜色词卡', '把常见颜色认熟。', colorVocab),
        listenChoice('u4', '听音选颜色', '听老师说颜色。', 'It is yellow.', '老师说的是哪种颜色？', [
          { id: 'a', label: 'yellow', emoji: '🌞' },
          { id: 'b', label: 'blue', emoji: '🫐' },
          { id: 'c', label: 'green', emoji: '🍃' },
        ], 'a'),
        speakRepeat('u4', '颜色介绍', '跟读“物品 + 颜色”的完整句子。', 'My bag is blue.', '注意 blue 的长音。', ['句子连贯', '语气自然', 'blue 还可以再清楚一点']),
        readChoice('u4', '阅读配色', '读一读，再回答问题。', 'Boy: My pen is red. Girl: My book is green.', 'What color is the pen?', [
          { id: 'a', label: 'Red', emoji: '🟥' },
          { id: 'b', label: 'Green', emoji: '🟩' },
          { id: 'c', label: 'Blue', emoji: '🟦' },
        ], 'a'),
        writeSpell('u4', '颜色拼写', '写出句子中的颜色词。', 'My bag is ____.', 'blue', ['这是一种常见颜色。', '答案有 4 个字母。']),
        challenge('u4', '颜色配对挑战', '把颜色和物品配起来。', [
          { id: randomUUID(), prompt: '“它是绿色的”对应哪句？', options: [{ id: 'a', label: 'It is green.' }, { id: 'b', label: 'It is a desk.' }, { id: 'c', label: 'She is my mother.' }], correctOptionId: 'a' },
          { id: randomUUID(), prompt: '哪句表示“我的书包是蓝色的”？', options: [{ id: 'a', label: 'My bag is blue.' }, { id: 'b', label: 'My book is green.' }, { id: 'c', label: 'Open your book.' }], correctOptionId: 'a' },
        ], ['u4-listen', 'u4-read', 'u4-write']),
      ],
    }),
    createUnit({
      subjectId,
      order: 5,
      title: 'Unit 5 · Numbers and Toys',
      stage: '阶段一 · 数字与玩具',
      goal: '学会基础数字表达，并能数一数常见物品或玩具。',
      emoji: '🧸',
      color: '#9bdcff',
      vocabulary: numberVocab,
      patterns: [
        { id: randomUUID(), sentence: 'How many ___?', slots: ['balls', 'pens', 'toys'], demoLine: 'How many toys?' },
        { id: randomUUID(), sentence: 'One / Two / Three ___.', slots: ['balls', 'pens'], demoLine: 'Two pens.' },
      ],
      reading: {
        id: randomUUID(),
        title: 'Count the toys',
        content: 'Girl: One toy, two toys, three toys. Boy: Great! I have three toys.',
        audioText: 'One toy, two toys, three toys.',
        question: 'How many toys?',
      },
      activities: [
        warmup('u5', '数字词卡', '边数边读，认识基础数字。', numberVocab),
        listenChoice('u5', '听音数一数', '听老师说数量。', 'Two pencils.', '老师说的是多少？', [
          { id: 'a', label: 'Two', emoji: '2️⃣' },
          { id: 'b', label: 'One', emoji: '1️⃣' },
          { id: 'c', label: 'Three', emoji: '3️⃣' },
        ], 'a'),
        speakRepeat('u5', '数玩具', '跟读一段数数句子。', 'One toy, two toys, three toys.', '读出节奏感会更自然。', ['数字读得很清楚', '节奏不错', 'three 的发音再放慢一点']),
        readChoice('u5', '读后选数量', '阅读后判断数量。', 'Boy: I have one toy. Girl: I have two toys.', 'How many toys does the girl have?', [
          { id: 'a', label: 'Two', emoji: '2️⃣' },
          { id: 'b', label: 'One', emoji: '1️⃣' },
          { id: 'c', label: 'Three', emoji: '3️⃣' },
        ], 'a'),
        writeSpell('u5', '数字拼写', '把数字单词写完整。', '___ toy.', 'one', ['表示数字 1。', '答案有 3 个字母。']),
        challenge('u5', '数数挑战', '把数字、听力和阅读一起通关。', [
          { id: randomUUID(), prompt: 'How many pens? 后面可以回答什么？', options: [{ id: 'a', label: 'Two pens.' }, { id: 'b', label: 'My name is Ben.' }, { id: 'c', label: 'It is blue.' }], correctOptionId: 'a' },
          { id: randomUUID(), prompt: '哪个单词表示数字 3？', options: [{ id: 'a', label: 'three' }, { id: 'b', label: 'toy' }, { id: 'c', label: 'blue' }], correctOptionId: 'a' },
        ], ['u5-listen', 'u5-read', 'u5-write']),
      ],
    }),
    createUnit({
      subjectId,
      order: 6,
      title: 'Unit 6 · Listen and Do',
      stage: '阶段一 · 基础课堂指令',
      goal: '能听懂并说出基础课堂指令，完成简单行动表达。',
      emoji: '🪄',
      color: '#b3e7ff',
      vocabulary: actionVocab,
      patterns: [
        { id: randomUUID(), sentence: 'Open your ___.', slots: ['book', 'bag'], demoLine: 'Open your book.' },
        { id: randomUUID(), sentence: 'Sit down / Stand up.', slots: ['sit', 'stand'], demoLine: 'Sit down, please.' },
      ],
      reading: {
        id: randomUUID(),
        title: 'In the class',
        content: 'Teacher: Stand up, please. Children: OK. Teacher: Open your book. Children: Yes!',
        audioText: 'Stand up, please. Open your book.',
        question: 'What should the children open?',
      },
      activities: [
        warmup('u6', '动作词卡', '跟着图片认识课堂动作。', actionVocab),
        listenChoice('u6', '听指令选动作', '听老师的课堂指令。', 'Open your book.', '老师要你做什么？', [
          { id: 'a', label: '打开书', emoji: '📘' },
          { id: 'b', label: '站起来', emoji: '🧍' },
          { id: 'c', label: '关上书', emoji: '📕' },
        ], 'a'),
        speakRepeat('u6', '跟读课堂指令', '完整跟读一句课堂指令。', 'Stand up, please.', '注意 please 的礼貌语气。', ['礼貌语气不错', '句子完整', 'stand 的开头还可以更清楚']),
        readChoice('u6', '阅读做动作', '阅读后选择正确答案。', 'Teacher: Sit down, please. Teacher: Close your book.', 'What should the child do first?', [
          { id: 'a', label: 'Sit down', emoji: '🪑' },
          { id: 'b', label: 'Open the book', emoji: '📘' },
          { id: 'c', label: 'Stand up', emoji: '🧍' },
        ], 'a'),
        writeSpell('u6', '指令拼写', '把动作词补完整。', '___ your book.', 'open', ['表示“打开”。', '答案有 4 个字母。']),
        challenge('u6', '课堂口令挑战', '完成听指令闯关。', [
          { id: randomUUID(), prompt: '哪句表示“请坐下”？', options: [{ id: 'a', label: 'Sit down, please.' }, { id: 'b', label: 'Open your bag.' }, { id: 'c', label: 'My bag is blue.' }], correctOptionId: 'a' },
          { id: randomUUID(), prompt: '“Open your book.” 里的核心动作词是？', options: [{ id: 'a', label: 'open' }, { id: 'b', label: 'book' }, { id: 'c', label: 'please' }], correctOptionId: 'a' },
        ], ['u6-listen', 'u6-read', 'u6-write']),
      ],
    }),
  ]
}
