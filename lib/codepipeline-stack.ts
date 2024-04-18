import {
  aws_codedeploy,
  aws_ecr,
  aws_ecs,
  aws_iam,
  aws_codebuild,
  aws_codecommit,
  aws_codepipeline,
  aws_codepipeline_actions,
  Stack,
  StackProps,
} from "aws-cdk-lib";

import * as path from "path";
import { Construct } from "constructs";

interface CodePipelineProps extends StackProps {
  codecommitRepoName: string;
  repoBranch: string;
  ecrRepoName: string;
  appDir: string;
  service: aws_ecs.FargateService;
  deploymentGroup: aws_codedeploy.EcsDeploymentGroup;
}

export class CodePipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: CodePipelineProps) {
    super(scope, id, props);

    // create codecommit repo
    const codecommitRepository = new aws_codecommit.Repository(
      this,
      "CodeCommitChatbot",
      {
        repositoryName: props.codecommitRepoName,
      }
    );

    // lookup ecr repo
    const ecrRepository = aws_ecr.Repository.fromRepositoryName(
      this,
      "EcrRepositoryForChatbot",
      props.ecrRepoName
    );

    // artifact - source code
    const sourceOutput = new aws_codepipeline.Artifact("SourceOutput");

    // artifact - codebuild output
    const codeBuildOutput = new aws_codepipeline.Artifact("CodeBuildOutput");

    // codebuild role push ecr image
    const codebuildRole = new aws_iam.Role(this, "RoleForCodeBuildChatbotApp", {
      assumedBy: new aws_iam.ServicePrincipal("codebuild.amazonaws.com"),
    });

    ecrRepository.grantPullPush(codebuildRole);

    // codebuild - build ecr image
    const ecrBuild = new aws_codebuild.PipelineProject(
      this,
      "BuildChatbotEcrImage",
      {
        projectName: "BuildChatbotEcrImage",
        role: codebuildRole,
        environment: {
          privileged: true,
          buildImage: aws_codebuild.LinuxBuildImage.STANDARD_5_0,
          computeType: aws_codebuild.ComputeType.MEDIUM,
          environmentVariables: {
            ACCOUNT_ID: {
              value: this.account,
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
            REGION: {
              value: this.region,
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
            REPO_NAME: {
              value: props.ecrRepoName,
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
            APP_DIR: {
              value: props.appDir,
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
            TAG: {
              value: "demo",
              type: aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            },
          },
        },

        // cdk upload build_spec.yaml to s3
        buildSpec: aws_codebuild.BuildSpec.fromAsset(
          path.join(__dirname, "./../buildspec/build_spec.yaml")
        ),
      }
    );

    // code pipeline
    new aws_codepipeline.Pipeline(this, "CodePipelineChatbot", {
      pipelineName: "CodePipelineChatbot",
      // cdk automatically creates role for codepipeline
      // role: pipelineRole,
      stages: [
        // source
        {
          stageName: "SourceCode",
          actions: [
            new aws_codepipeline_actions.CodeCommitSourceAction({
              actionName: "CodeCommitChatbot",
              repository: codecommitRepository,
              branch: props.repoBranch,
              output: sourceOutput,
            }),
          ],
        },

        // build docker image and push to ecr
        {
          stageName: "BuildChatbotEcrImageStage",
          actions: [
            new aws_codepipeline_actions.CodeBuildAction({
              actionName: "BuildChatbotEcrImage",
              project: ecrBuild,
              input: sourceOutput,
              outputs: [codeBuildOutput],
            }),
          ],
        },
        // deploy new tag image to ecs service
        // {
        //   stageName: "EcsCodeDeploy",
        //   actions: [
        //     new aws_codepipeline_actions.EcsDeployAction({
        //       // role: pipelineRole,
        //       actionName: "Deploy",
        //       service: props.service,
        //       input: codeBuildOutput,
        //       // imageFile: codeBuildOutput.atPath(""),
        //       deploymentTimeout: Duration.minutes(10),
        //     }),
        //   ],
        // },
        {
          stageName: "EcsCodeDeployBlueGreen",
          actions: [
            new aws_codepipeline_actions.CodeDeployEcsDeployAction({
              actionName: "EcsDeployGlueGreen",
              deploymentGroup: props.deploymentGroup,
              // file name shoulde be appspec.yaml
              appSpecTemplateInput: sourceOutput,
              // update task definition
              containerImageInputs: [
                {
                  // should contain imageDetail.json
                  input: codeBuildOutput,
                  taskDefinitionPlaceholder: "IMAGE1_NAME",
                },
              ],
              // should be taskdef.json
              taskDefinitionTemplateInput: sourceOutput,
              // variablesNamespace: ''
            }),
          ],
        },
      ],
    });
  }
}
