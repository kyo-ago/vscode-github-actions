import * as vscode from "vscode";
import * as path from "path";

import {convertWorkflowTemplate, NoOperationTraceWriter, parseWorkflow} from "@actions/workflow-parser";
import type {WorkflowTemplate, WorkflowJob, Step} from "@actions/workflow-parser/model/workflow-template";
import type {StringToken} from "@actions/workflow-parser/templates/tokens/string-token";
import type {File} from "@actions/workflow-parser/workflows/file";

export class GitHubActionsLinkProvider implements vscode.DocumentLinkProvider {
  async provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentLink[]> {
    try {
      const workflowTemplate = await this.parseWorkflowFile(document, token);
      if (!workflowTemplate) {
        return [];
      }

      return this.extractLinksFromWorkflow(document, workflowTemplate, token);
    } catch {
      return [];
    }
  }

  private async parseWorkflowFile(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<WorkflowTemplate | null> {
    const file: File = {
      name: document.uri.fsPath,
      content: document.getText()
    };

    const parseResult = parseWorkflow(file, new NoOperationTraceWriter());

    if (!parseResult.value || token.isCancellationRequested) {
      return null;
    }

    const workflowTemplate = await convertWorkflowTemplate(parseResult.context, parseResult.value);

    if (token.isCancellationRequested) {
      return null;
    }

    return workflowTemplate;
  }

  private extractLinksFromWorkflow(
    document: vscode.TextDocument,
    workflowTemplate: WorkflowTemplate,
    token: vscode.CancellationToken
  ): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = [];

    for (const job of workflowTemplate.jobs) {
      if (token.isCancellationRequested) {
        break;
      }

      const jobLinks = this.extractLinksFromJob(document, job);
      links.push(...jobLinks);
    }

    return links;
  }

  private extractLinksFromJob(document: vscode.TextDocument, job: WorkflowJob): vscode.DocumentLink[] {
    if (job.type !== "job" || !("steps" in job)) {
      return [];
    }

    const links: vscode.DocumentLink[] = [];

    for (const step of job.steps) {
      const link = this.createLinkFromStep(document, step);
      if (link) {
        links.push(link);
      }
    }

    return links;
  }

  private createLinkFromStep(document: vscode.TextDocument, step: Step): vscode.DocumentLink | null {
    if (!("uses" in step) || !step.uses) {
      return null;
    }

    const usesToken = step.uses;
    if (!usesToken.range) {
      return null;
    }

    const range = this.createRangeFromToken(usesToken);
    const targetUri = this.resolveUsesPath(document, usesToken.value);

    if (!targetUri) {
      return null;
    }

    return new vscode.DocumentLink(range, targetUri);
  }

  private createRangeFromToken(token: StringToken): vscode.Range {
    if (!token.range) {
      throw new Error("Token range is required");
    }

    const startPos = new vscode.Position(token.range.start.line - 1, token.range.start.column - 1);
    const endPos = new vscode.Position(token.range.end.line - 1, token.range.end.column - 1);

    return new vscode.Range(startPos, endPos);
  }

  private resolveUsesPath(document: vscode.TextDocument, usesValue: string): vscode.Uri | null {
    if (usesValue.startsWith("./")) {
      return this.resolveLocalAction(document, usesValue);
    }

    if (usesValue.includes("/")) {
      return this.resolveGitHubAction(usesValue);
    }

    return null;
  }

  private resolveLocalAction(document: vscode.TextDocument, usesValue: string): vscode.Uri | null {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return null;
    }

    let relativePath = usesValue.substring(2);

    const atIndex = relativePath.indexOf("@");
    if (atIndex !== -1) {
      relativePath = relativePath.substring(0, atIndex);
    }

    const hasYamlExtension = relativePath.endsWith(".yml") || relativePath.endsWith(".yaml");
    if (hasYamlExtension) {
      return null;
    }

    const actionPath = path.join(workspaceFolder.uri.fsPath, relativePath, "action.yml");
    return vscode.Uri.file(actionPath);
  }

  private resolveGitHubAction(usesValue: string): vscode.Uri | null {
    const atIndex = usesValue.indexOf("@");
    const actionPath = atIndex !== -1 ? usesValue.substring(0, atIndex) : usesValue;

    const parts = actionPath.split("/");
    if (parts.length < 2) {
      return null;
    }

    const org = parts[0];
    const repo = parts[1];
    const subPath = parts.slice(2).join("/");

    if (subPath) {
      const githubUrl = `https://github.com/${org}/${repo}/tree/main/${subPath}`;
      return vscode.Uri.parse(githubUrl);
    }

    const githubUrl = `https://github.com/${org}/${repo}`;
    return vscode.Uri.parse(githubUrl);
  }
}
