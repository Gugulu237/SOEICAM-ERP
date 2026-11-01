import { MutationCache, QueryClient } from '@tanstack/react-query';
import { uiMessage } from './i18n.js';


export const queryClientInstance = new QueryClient({
	mutationCache: new MutationCache({onMutate: () => {
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			throw new Error(uiMessage('You are offline. Reconnect before saving.'));
		}
	}}),
	defaultOptions: {
		// Never silently queue a business operation for a later reconnection.
		mutations: {networkMode: 'always', retry: false},
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});
