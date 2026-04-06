import { readFileTool } from "./read-file.ts";
import { writeFileTool } from "./write-file.ts";
import { editFileTool } from "./edit-file.ts";
import { bashTool } from "./bash.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { listDirectoryTool } from "./list-directory.ts";
import { webFetchTool } from "./web-fetch.ts";
import { thinkTool } from "./think.ts";
import { playwrightTool } from "./playwright.ts";

export const tools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  bash: bashTool,
  glob: globTool,
  grep: grepTool,
  list_directory: listDirectoryTool,
  web_fetch: webFetchTool,
  think: thinkTool,
  playwright: playwrightTool,
};
