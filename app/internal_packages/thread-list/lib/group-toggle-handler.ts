let handler: ((id: string) => void) | null = null;

export const setGroupToggleHandler = (fn: ((id: string) => void) | null) => {
  handler = fn;
};

export const toggleGroupById = (id: string) => {
  if (handler) {
    handler(id);
  }
};
