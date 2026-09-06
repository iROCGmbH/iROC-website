import React, { createContext, useContext } from 'react';
import { useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';

interface AuthContextType {
  isAuthenticated: boolean;
  instrument: string | null;
  isLoading: boolean;
  isFetching: boolean;
  checkAuth: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data, isLoading, isFetching, refetch } = useGetMe({
    query: {
      retry: false,
      queryKey: getGetMeQueryKey()
    }
  });

  return (
    <AuthContext.Provider 
      value={{ 
        isAuthenticated: !!data?.authenticated, 
        instrument: data?.instrument || null,
        isLoading,
        isFetching,
        checkAuth: () => refetch()
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
