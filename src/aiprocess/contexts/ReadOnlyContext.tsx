import React, { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

interface ReadOnlyContextType {
  isReadOnly: boolean;
  shareToken?: string;
}

const ReadOnlyContext = createContext<ReadOnlyContextType>({
  isReadOnly: false,
  shareToken: undefined,
});

export const useReadOnly = () => useContext(ReadOnlyContext);

interface ReadOnlyProviderProps {
  children: ReactNode;
  isReadOnly: boolean;
  shareToken?: string;
}

export const ReadOnlyProvider: React.FC<ReadOnlyProviderProps> = ({
  children,
  isReadOnly,
  shareToken,
}) => {
  return (
    <ReadOnlyContext.Provider value={{ isReadOnly, shareToken }}>
      {children}
    </ReadOnlyContext.Provider>
  );
};

export default ReadOnlyContext;
