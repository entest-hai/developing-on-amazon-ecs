import * as cdk from "aws-cdk-lib";
import { EcrStack } from "../lib/ecr-stack";
import { AlbStack } from "../lib/alb-stack";
import { EcsClusterStack } from "../lib/ecs-cluster-stack";
import { EcsChatServiceStack } from "../lib/ecs-chat-service";
import { EcsDeploymentGroup } from "../lib/ecs-deployment-group";
import { CodePipelineStack } from "../lib/codepipeline-stack";
import { NetworkStack } from "../lib/network-stack";
import { EcsBookServiceStack } from "../lib/ecs-book-service";

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
const network = new NetworkStack(app, "NetworkStack", {
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
const cluster = new EcsClusterStack(app, "EcsClusterStack", {
  vpc: network.vpc,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});

// create ecs service
const chat = new EcsChatServiceStack(app, "EcsServiceStack", {
  cluster: cluster.cluster,
  ecrRepoName: ECR_REPO_NAME,
  alb: alb.alb,
  listener: alb.prodListener,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});

// create ecs book service
const book = new EcsBookServiceStack(app, "EcsBookService", {
  cluster: cluster.cluster,
  ecrRepoName: ECR_REPO_NAME,
  alb: alb.alb,
  listener: alb.prodListener,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});

// deployment group
const deploymentGroup = new EcsDeploymentGroup(app, "DeploymentGroupStack", {
  service: chat.service,
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
  service: chat.service,
  deploymentGroup: deploymentGroup.deploymentGroup,
  env: {
    region: REGION,
    account: ACCOUNT,
  },
});
