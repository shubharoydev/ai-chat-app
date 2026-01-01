import { signupSchema, loginSchema } from '../utils/validator.js';

describe('Authenticator Validation', () => {
    test('signupSchema validates correct input', () => {
        const validUser = {
            name: 'Test User',
            email: 'test@example.com',
            password: 'password123'
        };
        const { error } = signupSchema.validate(validUser);
        expect(error).toBeUndefined();
    });

    test('signupSchema fails on invalid email', () => {
        const invalidUser = {
            name: 'Test User',
            email: 'invalid-email',
            password: 'password123'
        };
        const { error } = signupSchema.validate(invalidUser);
        expect(error).toBeDefined();
    });

    test('loginSchema validates correct input', () => {
        const validLogin = {
            email: 'test@example.com',
            password: 'password123'
        };
        const { error } = loginSchema.validate(validLogin);
        expect(error).toBeUndefined();
    });
});
