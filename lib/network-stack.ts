import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as aws_ec2 from "aws-cdk-lib/aws-ec2";

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
