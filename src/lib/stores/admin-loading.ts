import { writable, derived } from 'svelte/store';

interface LoadingOperation {
  id: string;
  type: 'navigation' | 'data' | 'action';
  description?: string;
}

interface AdminLoadingState {
  operations: LoadingOperation[];
  isLoading: boolean;
  hasNavigationLoading: boolean;
  hasDataLoading: boolean;
}

// Core loading store
const adminLoadingState = writable<AdminLoadingState>({
  operations: [],
  isLoading: false,
  hasNavigationLoading: false,
  hasDataLoading: false
});

// Derived stores for specific use cases
export const isAdminLoading = derived(
  adminLoadingState,
  ($state) => $state.isLoading
);

export const isNavigationLoading = derived(
  adminLoadingState,
  ($state) => $state.hasNavigationLoading
);

export const isDataLoading = derived(
  adminLoadingState,
  ($state) => $state.hasDataLoading
);

// Store management functions
export const adminLoading = {
  subscribe: adminLoadingState.subscribe,
  
  startOperation: (operation: LoadingOperation) => {
    adminLoadingState.update(state => {
      const newOperations = [...state.operations, operation];
      return {
        operations: newOperations,
        isLoading: newOperations.length > 0,
        hasNavigationLoading: newOperations.some(op => op.type === 'navigation'),
        hasDataLoading: newOperations.some(op => op.type === 'data')
      };
    });
  },
  
  endOperation: (operationId: string) => {
    adminLoadingState.update(state => {
      const newOperations = state.operations.filter(op => op.id !== operationId);
      return {
        operations: newOperations,
        isLoading: newOperations.length > 0,
        hasNavigationLoading: newOperations.some(op => op.type === 'navigation'),
        hasDataLoading: newOperations.some(op => op.type === 'data')
      };
    });
  },
  
  clear: () => {
    adminLoadingState.set({
      operations: [],
      isLoading: false,
      hasNavigationLoading: false,
      hasDataLoading: false
    });
  }
};