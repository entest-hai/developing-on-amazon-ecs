import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import * as aws_ec2 from "aws-cdk-lib/aws-ec2";
import * as aws_ecr from "aws-cdk-lib/aws-ecr";
import * as aws_ecs from "aws-cdk-lib/aws-ecs";
import * as aws_elasticloadbalancingv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as aws_iam from "aws-cdk-lib/aws-iam";
import { FargatePlatformVersion } from "aws-cdk-lib/aws-ecs";
import { Effect } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface EcsBookServiceProps extends StackProps {
  ecrRepoName: string;
  cluster: aws_ecs.Cluster;
  alb: aws_elasticloadbalancingv2.ApplicationLoadBalancer;
  listener: aws_elasticloadbalancingv2.ApplicationListener;
}

export class EcsBookServiceStack extends Stack {
  public readonly service: aws_ecs.FargateService;

  constructor(scope: Construct, id: string, props: EcsBookServiceProps) {
    super(scope, id, props);

    // task role
    const executionRole = new aws_iam.Role(
      this,
      "RoleForEcsTaskToPullEcrBookImage",
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
      "TaskDefinitionForBookService",
      {
        family: "latest",
        cpu: 2048,
        memoryLimitMiB: 4096,
        runtimePlatform: {
          operatingSystemFamily: aws_ecs.OperatingSystemFamily.LINUX,
          cpuArchitecture: aws_ecs.CpuArchitecture.X86_64,
        },
        // retrieve container images from ECR
        executionRole: executionRole,
      }
    );

    // taask add container
    task.addContainer("ContainerForBookService", {
      containerName: props.ecrRepoName,
      memoryLimitMiB: 4096,
      memoryReservationMiB: 4096,
      stopTimeout: Duration.seconds(120),
      startTimeout: Duration.seconds(120),
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
    const service = new aws_ecs.FargateService(this, "BookService", {
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

    // alb listener add ecs services as targets
    props.listener.addTargets("EcsBookService", {
      priority: 1,
      conditions: [
        aws_elasticloadbalancingv2.ListenerCondition.pathPatterns(["*"]),
      ],
      deregistrationDelay: Duration.seconds(30),
      port: 80,
      targets: [
        service.loadBalancerTarget({
          containerName: props.ecrRepoName,
          containerPort: 3000,
        }),
      ],
    });

    // exported
    this.service = service;

    // export task role
    new CfnOutput(this, "EcsTaskRoleForBookService", {
      value: task.taskRole.roleArn,
      exportName: "EcsTaskRoleForBookService",
    });

    // export task execution role
    new CfnOutput(this, "EcsTaskExecutionRoleForBookService", {
      value: task.executionRole!.roleArn,
      exportName: "EcsTaskExecutionRoleForBookService",
    });
  }
}
