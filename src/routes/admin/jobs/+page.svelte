<script lang="ts">
	import JobsTable from '$lib/components/JobsTable.svelte';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { getLogger } from '@logtape/logtape';
	import type { JobsApiResponse, JobInformation } from '$lib/types/jobs-api';

	const logger = getLogger(['routes', 'admin', 'jobs']);

	let { data } = $props<{ jobs: Promise<JobsApiResponse>, sessiontoken: Promise<string | undefined> }>();

	async function resetFailedJobs() {
		const token = await data.sessiontoken;
		if (!token) {
			logger.error('No session token found');
			return;
		}

		try {
			const response = await fetch('/api/admin/jobs/reset', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`
				}
			});

			if (response.ok) {
				await invalidateAll();
			} else {
				const errorText = await response.text();
				logger.error('Failed to reset jobs: {error}', { error: errorText });
				// Optionally, display an error message to the user
			}
		} catch (error) {
			logger.error('An error occurred while resetting jobs: {error}', { error });
		}
	}
</script>

{#await data.jobs}
	<p>Loading jobs...</p>
{:then result}
	{@const jobs = result.data}
	{@const hasFailedJobs = jobs?.some((job: JobInformation) => job.status === 'failed')}
	<div class="space-y-6">
		<!-- Page Header -->
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-bold">Job Management</h1>
				<p class="text-muted-foreground mt-2">Monitor and manage system jobs</p>
			</div>
			{#if hasFailedJobs}
				<Button onclick={resetFailedJobs} variant="destructive">Reset Failed Jobs</Button>
			{/if}
		</div>

		<!-- Jobs Table -->
		<div class="space-y-4">
			<JobsTable jobs={jobs} pagination={result.pagination} />
		</div>
	</div>
{:catch error}
	<p class="text-red-500">Failed to load jobs: {error.message}</p>
{/await}