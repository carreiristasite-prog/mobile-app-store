export type ProblemDetails = {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  errors?: Record<string, string[]>;
  traceId?: string;
  requestId?: string;
};

export type ApiNetworkState = 'checking' | 'online' | 'offline' | 'unconfigured';

export type MutationResult<T> =
  | { state: 'completed'; data: T }
  | { state: 'queued'; queueId: string };

export class ApiError extends Error {
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail || problem.title);
    this.name = 'ApiError';
    this.problem = problem;
  }
}

export class ApiNetworkError extends Error {
  constructor(message = 'Não foi possível conectar ao IA Aprova.') {
    super(message);
    this.name = 'ApiNetworkError';
  }
}

export class ApiConfigurationError extends Error {
  constructor() {
    super('O endereço seguro da API não foi configurado neste build.');
    this.name = 'ApiConfigurationError';
  }
}

export class ApiSessionChangedError extends Error {
  constructor() {
    super('A conta ativa mudou. Tente novamente.');
    this.name = 'ApiSessionChangedError';
  }
}

export function toUserMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail || error.problem.title;
  if (error instanceof ApiConfigurationError || error instanceof ApiNetworkError || error instanceof ApiSessionChangedError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Algo deu errado. Tente novamente.';
}
