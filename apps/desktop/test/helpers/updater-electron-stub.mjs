export const app = {
  getAppPath: () => process.cwd(),
  getVersion: () => "0.16.0",
  isPackaged: false,
};

export const shell = {
  opened: [],
  failure: null,
  openExternal: async (url) => {
    shell.opened.push(url);
    if (shell.failure) throw shell.failure;
  },
};
