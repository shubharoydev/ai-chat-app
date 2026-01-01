import './__mocks__/apiMocks'; 
import { render } from '@testing-library/react';
import App from './App';
import { describe, it, expect, vi } from 'vitest';


describe('App Component', () => {
    it('renders without crashing', () => {
        render(<App />);
        // Since it redirects to /login or renders Home based on auth, 
        // and we mocked auth to return nothing/pending, it typically renders something.
        // Let's just check if the document body exists.
        expect(document.body).toBeTruthy();
    });
});
