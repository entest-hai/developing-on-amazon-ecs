---
author: haimtran
title: developing on amazon ecs
date: 20/08/2023
---

## Introduction

[GitHub](https://github.com/cdk-entest/developing-on-amazon-ecs) this project shows how to build a chatbot and deploy it on amazon ecs.

[![screencast thumbnail](./assets/ecs-blue-green-deployment.png)](https://d2cvlmmg8c0xrp.cloudfront.net/mp4/ecs-chatbot-app-part-2.mp4)

> [!WARNING]
>
> - Tested with "aws-cdk-lib": "2.93.0"
> - Need to use taskdef.json, appspec.yaml and iamgeDetail.json
> - Pull image from docker hub might experience rate limit

## Network Stack

Let create a VPC with three subnets and security groups for ALB and ECS service

```ts
import { Stack, StackProps, aws_ec2 } from "aws-cdk-lib";
import { Construct } from "constructs";

interface VpcProps extends StackProps {
  cidr: string;
}

export class NetworkStack extends Stack {
  public readonly vpc: aws_ec2.Vpc;
  public readonly sgForAlb: aws_ec2.SecurityGroup;
  public readonly sgForGoWebapp: aws_ec2.SecurityGroup;
  public readonly sgForCvSummaryService: aws_ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: VpcProps) {
    super(scope, id, props);

    const vpc = new aws_ec2.Vpc(this, "VPC", {
      maxAzs: 3,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      ipAddresses: aws_ec2.IpAddresses.cidr(props.cidr),
      natGatewayProvider: aws_ec2.NatProvider.gateway(),
      natGateways: 1,
      subnetConfiguration: [
        {
          // cdk add igw and route tables
          name: "PublicSubnet",
          cidrMask: 24,
          subnetType: aws_ec2.SubnetType.PUBLIC,
        },
        {
          // cdk add nat and route tables
          name: "PrivateSubnetNat",
          cidrMask: 24,
          subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // security group for load balancer
    const sgForAlb = new aws_ec2.SecurityGroup(this, "SGForAlb", {
      vpc,
      allowAllOutbound: true,
    });

    // open http for the world
    sgForAlb.addIngressRule(aws_ec2.Peer.anyIpv4(), aws_ec2.Port.tcp(80));

    // security group for ecs go webapp service
    const sgForGoWebapp = new aws_ec2.SecurityGroup(this, "SGForGoWebapp", {
      vpc,
      allowAllOutbound: true,
    });

    // open port 3000 for alb
    sgForGoWebapp.addIngressRule(sgForAlb, aws_ec2.Port.tcp(3000));

    // security group for ecs cv summary service
    const sgForCvSummaryService = new aws_ec2.SecurityGroup(
      this,
      "SGForCvSummaryService",
      {
        vpc,
        allowAllOutbound: true,
      }
    );

    // open port 8080 for alb
    sgForCvSummaryService.addIngressRule(sgForAlb, aws_ec2.Port.tcp(8080));

    // export output
    this.vpc = vpc;
    this.sgForAlb = sgForAlb;
    this.sgForGoWebapp = sgForGoWebapp;
    this.sgForCvSummaryService = sgForCvSummaryService;
  }
}
```

## Load Balancer Stack

Let create an ALB with two targe groups (blue and green), and two listeners (production and test).

```ts
import {
  aws_ec2,
  aws_elasticloadbalancingv2,
  Duration,
  Stack,
  StackProps,
} from "aws-cdk-lib";

import { Construct } from "constructs";

interface AlbProps extends StackProps {
  vpc: aws_ec2.Vpc;
}

export class AlbStack extends Stack {
  public readonly alb: aws_elasticloadbalancingv2.ApplicationLoadBalancer;
  public readonly blueTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  public readonly greenTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  public readonly prodListener: aws_elasticloadbalancingv2.ApplicationListener;

  constructor(scope: Construct, id: string, props: AlbProps) {
    super(scope, id, props);

    // application load balancer
    const alb = new aws_elasticloadbalancingv2.ApplicationLoadBalancer(
      this,
      "AlbForEcs",
      {
        vpc: props.vpc,
        internetFacing: true,
      }
    );

    // add product listener
    const prodListener = alb.addListener("ProdListener", {
      port: 80,
      open: true,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
    });

    // add test listener
    const testListener = alb.addListener("TestListener", {
      port: 8080,
      open: true,
      protocol: aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
    });

    prodListener.connections.allowDefaultPortFromAnyIpv4("");
    testListener.connections.allowDefaultPortFromAnyIpv4("");

    // blue target group
    const blueTargetGroup =
      new aws_elasticloadbalancingv2.ApplicationTargetGroup(
        this,
        "GlueTargetGroup",
        {
          targetType: aws_elasticloadbalancingv2.TargetType.IP,
          port: 80,
          healthCheck: {
            timeout: Duration.seconds(20),
            interval: Duration.seconds(35),
            path: "/",
            protocol: aws_elasticloadbalancingv2.Protocol.HTTP,
          },
          vpc: props.vpc,
        }
      );

    // green target group
    const greenTargetGroup =
      new aws_elasticloadbalancingv2.ApplicationTargetGroup(
        this,
        "GreenTargetGroup",
        {
          targetType: aws_elasticloadbalancingv2.TargetType.IP,
          healthCheck: {
            timeout: Duration.seconds(20),
            interval: Duration.seconds(35),
            path: "/",
            protocol: aws_elasticloadbalancingv2.Protocol.HTTP,
          },
          port: 80,
          vpc: props.vpc,
        }
      );

    prodListener.addTargetGroups("GlueTargetGroup", {
      targetGroups: [blueTargetGroup],
    });

    testListener.addTargetGroups("GreenTargetGroup", {
      targetGroups: [greenTargetGroup],
    });

    // export output
    this.alb = alb;
    this.blueTargetGroup = blueTargetGroup;
    this.greenTargetGroup = greenTargetGroup;
    this.prodListener = prodListener;
  }
}
```

## ECS Cluster Stack

Let create a ECS cluster

```ts
import {
  aws_ec2,
  aws_ecs,
  Stack,
  StackProps,
  IAspect,
  Aspects,
} from "aws-cdk-lib";
import { Construct, IConstruct } from "constructs";

interface EcsClusterProps extends StackProps {
  vpc: aws_ec2.Vpc;
}

export class EcsClusterStack extends Stack {
  public readonly cluster: aws_ecs.Cluster;

  constructor(scope: Construct, id: string, props: EcsClusterProps) {
    super(scope, id, props);

    Aspects.of(this).add(new CapacityProviderDependencyAspect());

    // ecs cluster
    this.cluster = new aws_ecs.Cluster(this, "EcsClusterBlueGreen", {
      vpc: props.vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
    });
  }
}

/**
 * Add a dependency from capacity provider association to the cluster
 * and from each service to the capacity provider association.
 */
class CapacityProviderDependencyAspect implements IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof aws_ecs.CfnClusterCapacityProviderAssociations) {
      // IMPORTANT: The id supplied here must be the same as the id of your cluster. Don't worry, you won't remove the cluster.
      node.node.scope?.node.tryRemoveChild("EcsClusterBlueGreen");
    }

    if (node instanceof aws_ecs.Ec2Service) {
      const children = node.cluster.node.findAll();
      for (const child of children) {
        if (child instanceof aws_ecs.CfnClusterCapacityProviderAssociations) {
          child.node.addDependency(node.cluster);
          node.node.addDependency(child);
        }
      }
    }
  }
}
```

## ECS Service Stack

Let create an ECS service stack

```ts
import {
  aws_codedeploy,
  aws_ec2,
  aws_ecr,
  aws_ecs,
  aws_elasticloadbalancingv2,
  aws_iam,
  Duration,
  Stack,
  StackProps,
} from "aws-cdk-lib";

import { FargatePlatformVersion } from "aws-cdk-lib/aws-ecs";
import { Effect } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface EcsServiceProps extends StackProps {
  ecrRepoName: string;
  cluster: aws_ecs.Cluster;
  alb: aws_elasticloadbalancingv2.ApplicationLoadBalancer;
  blueTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
}

export class EcsServiceStack extends Stack {
  public readonly service: aws_ecs.FargateService;

  constructor(scope: Construct, id: string, props: EcsServiceProps) {
    super(scope, id, props);

    // task role
    const executionRole = new aws_iam.Role(
      this,
      "RoleForEcsTaskToPullEcrChatbotImage",
      {
        assumedBy: new aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      }
    );

    // execution role
    executionRole.addToPolicy(
      new aws_iam.PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ecr:*"],
        resources: ["*"],
      })
    );

    // ecs task definition
    const task = new aws_ecs.FargateTaskDefinition(
      this,
      "TaskDefinitionForWeb",
      {
        family: "latest",
        cpu: 2048,
        memoryLimitMiB: 4096,
        runtimePlatform: {
          operatingSystemFamily: aws_ecs.OperatingSystemFamily.LINUX,
          cpuArchitecture: aws_ecs.CpuArchitecture.X86_64,
        },
        // taskRole: "",
        // retrieve container images from ECR
        executionRole: executionRole,
      }
    );

    // taask add container
    task.addContainer("GoWebAppContainer", {
      containerName: props.ecrRepoName,
      memoryLimitMiB: 4096,
      memoryReservationMiB: 4096,
      stopTimeout: Duration.seconds(120),
      startTimeout: Duration.seconds(120),
      // image: aws_ecs.ContainerImage.fromRegistry(
      //   "public.ecr.aws/b5v7e4v7/entest-chatbot-app:latest"
      // ),
      image: aws_ecs.ContainerImage.fromEcrRepository(
        aws_ecr.Repository.fromRepositoryName(
          this,
          props.ecrRepoName,
          props.ecrRepoName
        )
      ),
      portMappings: [{ containerPort: 3000 }],
    });

    // service
    const service = new aws_ecs.FargateService(this, "ChatbotService", {
      vpcSubnets: {
        subnetType: aws_ec2.SubnetType.PUBLIC,
      },
      assignPublicIp: true,
      cluster: props.cluster,
      taskDefinition: task,
      desiredCount: 2,
      deploymentController: {
        type: aws_ecs.DeploymentControllerType.CODE_DEPLOY,
      },
      capacityProviderStrategies: [
        {
          capacityProvider: "FARGATE",
          weight: 1,
        },
        {
          capacityProvider: "FARGATE_SPOT",
          weight: 0,
        },
      ],
      platformVersion: FargatePlatformVersion.LATEST,
    });

    // attach service to target group
    service.connections.allowFrom(props.alb, aws_ec2.Port.tcp(80));
    service.connections.allowFrom(props.alb, aws_ec2.Port.tcp(8080));
    service.attachToApplicationTargetGroup(props.blueTargetGroup);

    // exported
    this.service = service;
  }
}

interface EcsDeploymentProps extends StackProps {
  service: aws_ecs.FargateService;
  blueTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  greenTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  listener: aws_elasticloadbalancingv2.ApplicationListener;
}

export class EcsDeploymentGroup extends Stack {
  public readonly deploymentGroup: aws_codedeploy.EcsDeploymentGroup;

  constructor(scope: Construct, id: string, props: EcsDeploymentProps) {
    super(scope, id, props);

    const service = props.service;
    const blueTargetGroup = props.blueTargetGroup;
    const greenTargetGroup = props.greenTargetGroup;
    const listener = props.listener;

    this.deploymentGroup = new aws_codedeploy.EcsDeploymentGroup(
      this,
      "BlueGreenDeploymentGroup",
      {
        service: service,
        blueGreenDeploymentConfig: {
          blueTargetGroup,
          greenTargetGroup,
          listener,
        },
        deploymentConfig: aws_codedeploy.EcsDeploymentConfig.ALL_AT_ONCE,
      }
    );
  }
}
```

## Deployment Group

The deployment group from CodeDeploy will handle the Blue/Green deployment with configuration and strategry for routing traffice such as ALL_AT_ONCE, CANARY.

```ts
interface EcsDeploymentProps extends StackProps {
  service: aws_ecs.FargateService;
  blueTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  greenTargetGroup: aws_elasticloadbalancingv2.ApplicationTargetGroup;
  listener: aws_elasticloadbalancingv2.ApplicationListener;
}

export class EcsDeploymentGroup extends Stack {
  public readonly deploymentGroup: aws_codedeploy.EcsDeploymentGroup;

  constructor(scope: Construct, id: string, props: EcsDeploymentProps) {
    super(scope, id, props);

    const service = props.service;
    const blueTargetGroup = props.blueTargetGroup;
    const greenTargetGroup = props.greenTargetGroup;
    const listener = props.listener;

    this.deploymentGroup = new aws_codedeploy.EcsDeploymentGroup(
      this,
      "BlueGreenDeploymentGroup",
      {
        service: service,
        blueGreenDeploymentConfig: {
          blueTargetGroup,
          greenTargetGroup,
          listener,
        },
        deploymentConfig: aws_codedeploy.EcsDeploymentConfig.ALL_AT_ONCE,
      }
    );
  }
}
```

## CI/CD Pipeline Stack

> [!IMPORTANT]
> Please pay attention to taskdef.json, appspec.yaml and imageDetail.json

Let create a CI/CD pipeline for deploying the chatbot app continuously as the following

```ts
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
```

> [!IMPORTANT]
> CDK automatically create role for codebuild, codedeploy, and codepipeline. Below is the content of the iam policy generated for codepipeline role. The codepline role will assume on of three different role for codebuild action, ecsdeploy action, and source action.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": [
        "s3:Abort*",
        "s3:DeleteObject*",
        "s3:GetBucket*",
        "s3:GetObject*",
        "s3:List*",
        "s3:PutObject",
        "s3:PutObjectLegalHold",
        "s3:PutObjectRetention",
        "s3:PutObjectTagging",
        "s3:PutObjectVersionTagging"
      ],
      "Resource": [
        "arn:aws:s3:::artifact-bucket-name",
        "arn:aws:s3:::artifact-bucket-name/*"
      ],
      "Effect": "Allow"
    },
    {
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:ReEncrypt*"
      ],
      "Resource": "arn:aws:kms:ap-southeast-1:$ACCOUNT_ID:key/$KEY_ID",
      "Effect": "Allow"
    },
    {
      "Action": "sts:AssumeRole",
      "Resource": [
        "arn:aws:iam::$ACCOUNT_ID:role/CodePipelineChatbotBuildC-9DSS5JG1VE7T",
        "arn:aws:iam::$ACCOUNT_ID:role/CodePipelineChatbotEcsCod-AO6ZDE82ELPC",
        "arn:aws:iam::$ACCOUNT_ID:role/CodePipelineChatbotSource-1SZLHE9CFAAXO"
      ],
      "Effect": "Allow"
    }
  ]
}
```

## CDK Deploy

Let create a CDK app in bin/ecs-blue-green-app.ts as below.

```ts
import * as cdk from "aws-cdk-lib";
import { EcrStack } from "../lib/ecr-stack";
import { AlbStack } from "../lib/alb-stack";
import { EcsClusterStack } from "../lib/ecs-cluster-stack";
import { EcsDeploymentGroup, EcsServiceStack } from "../lib/ecs-service-stack";
import { CodePipelineStack } from "../lib/codepipeline-stack";
import { NetworkStack } from "../lib/network-stack";

const app = new cdk.App();

// parameters
const REGION = process.env.CDK_DEFAULT_REGION;
const ACCOUNT = process.env.CDK_DEFAULT_ACCOUNT;
const CIDR = "10.0.0.0/16";
const ECR_REPO_NAME = "go-blue-green-app";
const CODE_COMMIT_REPO_NAME = "go-blue-green-app";
const REPO_BRANCH = "main";
const APP_DIR = "go-web-app";

// create an ecr repository
const ecr = new EcrStack(app, "EcrStack", {
  repoName: ECR_REPO_NAME,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});

// create vpc
const network = new NetworkStack(app, "NetworkStackBlue", {
  cidr: CIDR,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});

// create application load balancer
const alb = new AlbStack(app, "AlbStackBlue", {
  vpc: network.vpc,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});

// create ecs cluster
const cluster = new EcsClusterStack(app, "EcsClusterStackBlue", {
  vpc: network.vpc,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});

// create ecs service
const service = new EcsServiceStack(app, "EcsServiceStackBlue", {
  cluster: cluster.cluster,
  ecrRepoName: ECR_REPO_NAME,
  alb: alb.alb,
  blueTargetGroup: alb.blueTargetGroup,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});

// deployment group
const deploymentGroup = new EcsDeploymentGroup(app, "DeploymentGroupStack", {
  service: service.service,
  blueTargetGroup: alb.blueTargetGroup,
  greenTargetGroup: alb.greenTargetGroup,
  listener: alb.prodListener,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});

// codpipeline blue green deployment
new CodePipelineStack(app, "CodePipelineStack", {
  codecommitRepoName: CODE_COMMIT_REPO_NAME,
  repoBranch: REPO_BRANCH,
  ecrRepoName: ECR_REPO_NAME,
  appDir: APP_DIR,
  service: service.service,
  deploymentGroup: deploymentGroup.deploymentGroup,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});
```

Script to deploy infrastructure using CDK

```py
cdk bootstrap aws://<ACCOUNT_ID>/us-west-2
cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' synth
cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy EcrStack
cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy NetworkStack
cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy AlbStack
cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy EcsClusterStack
cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy DeploymentGroupStack
cdk --app 'npx ts-node --prefer-ts-exts bin/ecs-blue-green-app.ts' deploy CodePipelineStack

```

## Application

There is a build.py script to build Docker image and push to ecr repository

```py
import os

# parameters
REGION = "us-west-2"
ACCOUNT = os.popen("aws sts get-caller-identity | jq -r '.Account'").read().strip()
APP_NAME = "go-blue-green-app"

# delete all docker images
os.system("sudo docker system prune -a")

# build go-blog-app image
os.system(f"sudo docker build -t {APP_NAME} . ")

#  aws ecr login
os.system(
    f"aws ecr get-login-password --region {REGION} | sudo docker login --username AWS --password-stdin {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com"
)

# get image id
IMAGE_ID = os.popen(f"sudo docker images -q {APP_NAME}:latest").read()

# tag {APP_NAME} image
os.system(
    f"sudo docker tag {IMAGE_ID.strip()} {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{APP_NAME}:latest"
)

# create ecr repository
os.system(
    f"aws ecr create-repository --registry-id {ACCOUNT} --repository-name {APP_NAME} --region {REGION}"
)

# push image to ecr
os.system(
    f"sudo docker push {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{APP_NAME}:latest"
)

# run locally to test
# os.system(f"sudo docker run -d -p 3001:3000 {APP_NAME}:latest")
```

## Referece

- [aws docs ecs standard](https://docs.aws.amazon.com/codepipeline/latest/userguide/ecs-cd-pipeline.html)

- [aws docs ecs blue green](https://docs.aws.amazon.com/codepipeline/latest/userguide/tutorials-ecs-ecr-codedeploy.html)

- [aws docs ecs](https://docs.aws.amazon.com/codedeploy/latest/userguide/tutorial-ecs-deployment.html)

- [ecs task and execution role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)

- [AmazonEC2ContainerRegistryPowerUser](https://docs.aws.amazon.com/codepipeline/latest/userguide/ecs-cd-pipeline.html)

- [vercel ai sdk](https://sdk.vercel.ai/docs/guides/providers/hugging-face)

- [github markdown guide](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)

- [aws ecs blue green pipeline](https://docs.aws.amazon.com/codepipeline/latest/userguide/tutorials-ecs-ecr-codedeploy.html)

- [imageDetail.json](https://docs.aws.amazon.com/codepipeline/latest/userguide/file-reference.html#file-reference-ecs-bluegreen)

- [aws-samples ecs blue green](https://github.com/aws-samples/ecs-blue-green-deployment/blob/master/templates/service.yaml)

- [amazon ecs blue green](https://aws.amazon.com/blogs/compute/bluegreen-deployments-with-amazon-ecs/)
