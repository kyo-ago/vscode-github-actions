import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'yaml';

export class GitHubActionsLinkProvider implements vscode.DocumentLinkProvider {
 provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
  const text = document.getText();
  const links: vscode.DocumentLink[] = [];

  try {
   // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
   const yamlContent = yaml.parse(text);
   console.log('Parsed YAML content:', JSON.stringify(yamlContent, null, 2));

   // Handle workflow files (with jobs)
   // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
   if (yamlContent?.jobs) {
    console.log('Processing workflow file with jobs');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    for (const jobName in yamlContent.jobs) {
     // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
     const job = yamlContent.jobs[jobName];
     // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
     if (job?.steps && Array.isArray(job.steps)) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unsafe-member-access
      console.log(`Processing job: ${jobName}, steps count: ${job.steps.length}`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      for (const step of job.steps) {
       // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
       if (step?.uses && typeof step.uses === 'string') {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unsafe-member-access
        console.log(`Found uses in job ${jobName}: ${step.uses}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
        links.push(...this.processUsesField(document, step.uses));
       }
      }
     }
    }
   }

   // Handle action files (with runs.steps)
   // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
   if (yamlContent?.runs?.steps && Array.isArray(yamlContent.runs.steps)) {
    console.log('Processing action file with runs.steps');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    for (const step of yamlContent.runs.steps) {
     // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
     if (step?.uses && typeof step.uses === 'string') {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unsafe-member-access
      console.log(`Found uses in action: ${step.uses}`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      links.push(...this.processUsesField(document, step.uses));
     }
    }
   }
  } catch (error) {
   console.error('Error parsing YAML:', error);
  }

  console.log(`Total links found: ${links.length}`);
  return links;
 }

 private processUsesField(document: vscode.TextDocument, usesValue: string): vscode.DocumentLink[] {
  const links: vscode.DocumentLink[] = [];
  const text = document.getText();
  let index = 0;
  const searchPattern = `uses: ${usesValue}`;

  while ((index = text.indexOf(searchPattern, index)) !== -1) {
   const startPos = document.positionAt(index + 'uses: '.length);
   const endPos = document.positionAt(index + searchPattern.length);
   const range = new vscode.Range(startPos, endPos);

   const targetUri = this.resolveUsesPath(document, usesValue);
   if (targetUri) {
    const link = new vscode.DocumentLink(range, targetUri);
    links.push(link);
   }

   index += searchPattern.length;
  }
  return links;
 }

 private resolveUsesPath(document: vscode.TextDocument, usesValue: string): vscode.Uri | null {
  console.log(`Resolving uses path: ${usesValue}`);

  // Handle local actions (starting with ./)
  if (usesValue.startsWith('./')) {
   return this.resolveLocalAction(document, usesValue);
  }

  // Handle external GitHub actions (org/repo format)
  if (usesValue.includes('/')) {
   return this.resolveGitHubAction(usesValue);
  }

  console.log(`Unknown action format: ${usesValue}`);
  return null;
 }

 private resolveLocalAction(document: vscode.TextDocument, usesValue: string): vscode.Uri | null {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
   console.log('No workspace folder found');
   return null;
  }

  let relativePath = usesValue.substring(2);

  const atIndex = relativePath.indexOf('@');
  if (atIndex !== -1) {
   relativePath = relativePath.substring(0, atIndex);
   console.log(`Stripped version tag, path: ${relativePath}`);
  }

  // Check if the path already ends with .yml or .yaml
  const hasYamlExtension = relativePath.endsWith('.yml') || relativePath.endsWith('.yaml');

  if (hasYamlExtension) {
   console.log(`Path already has YAML extension, skipping: ${relativePath}`);
   return null;
  }

  // If no YAML extension, add /action.yml by default
  // VSCode will handle if the file doesn't exist
  const actionPath = path.join(workspaceFolder.uri.fsPath, relativePath, 'action.yml');
  console.log(`Resolved local action path: ${actionPath}`);
  return vscode.Uri.file(actionPath);
 }

 private resolveGitHubAction(usesValue: string): vscode.Uri | null {
  // Remove version tag if present
  const atIndex = usesValue.indexOf('@');
  const actionPath = atIndex !== -1 ? usesValue.substring(0, atIndex) : usesValue;

  // Split into parts: org/repo or org/repo/subpath
  const parts = actionPath.split('/');
  if (parts.length < 2) {
   console.log(`Invalid GitHub action format: ${usesValue}`);
   return null;
  }

  const org = parts[0];
  const repo = parts[1];
  const subPath = parts.slice(2).join('/');

  // Construct GitHub URL
  let githubUrl: string;
  if (subPath) {
   // Action is in a subdirectory
   githubUrl = `https://github.com/${org}/${repo}/tree/main/${subPath}`;
   console.log(`GitHub action with subpath: ${githubUrl}`);
  } else {
   // Action is at repository root
   githubUrl = `https://github.com/${org}/${repo}`;
   console.log(`GitHub action at repo root: ${githubUrl}`);
  }

  return vscode.Uri.parse(githubUrl);
 }
}
