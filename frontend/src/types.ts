export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  rows?: Record<string, string | number>[];
  timestamp: number;
}

export interface ChatResponse {
  success: boolean;
  data: {
    question: string;
    sql: string;
    rows: Record<string, string | number>[];
    count: number;
    conversation_id: string;
    answer?: string;
  };
}
