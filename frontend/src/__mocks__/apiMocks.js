import { vi } from 'vitest';

vi.mock('../utils/api.js', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
    login: vi.fn(),
    logout: vi.fn(),
    getFriends: vi.fn(),
}));

vi.mock('../utils/WebSocket.js', () => ({
    connectWebSocket: vi.fn(),
    disconnectWebSocket: vi.fn(),
    sendWebSocketMessage: vi.fn(),
}));
