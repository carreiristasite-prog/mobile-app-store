export type UserQuestion = {
  id: string;
  bancaId: string;
  discipline: string;
  stimulus?: {
    type: 'text';
    content: string;
    source: string;
  };
  question: string;
  options: Array<{ label: string }>;
  correctOptionIndex: number;
  difficulty: 'medium';
  cognitiveLevel: 'apply';
  explanation: string;
  sourceTheme: string;
  tags: string[];
  expectedTime: number;
  source: string;
};
