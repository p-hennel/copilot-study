import { authClient } from '$lib/auth-client';
import { fetchAdminData } from '$lib/utils/admin-fetch';
import type { PageLoadEvent } from './$types';

export async function load(event: PageLoadEvent) {
	const token = authClient.getSession().then((response) => response.data?.session.token);

	return {
		jobs: fetchAdminData(event.fetch, 'jobs', token, { description: 'Loading jobs...' }),
		sessiontoken: token
	};
}